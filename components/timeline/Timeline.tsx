'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { peakBetween, peaksFrom } from '@/lib/audio/peaks'
import { qcTrack, srtToSec } from '@/lib/subtitles'
import { clockLabel, rulerLabel, tickEvery } from '@/lib/timeline/ruler'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle } from '@/types/subtitle'

/**
 * The waveform, the cues, and where we are in the audio.
 *
 * This is the difference between a subtitling tool and a text editor with a
 * timecode column: it is how somebody sees that a cue starts a beat before the
 * line is spoken — invisible in a list, obvious here.
 *
 * The audio never leaves the browser. It is decoded locally for drawing and
 * playback, so scrubbing costs nothing and it works on a file that was never
 * uploaded: a subtitler correcting an SRT against a screener does not need us
 * to hold their video.
 */

const RULER_H = 18
const BLOCK_H = 38
const HEIGHT = 132

/** Roughly one label per this many pixels, before rounding to a tidy interval. */
const PX_PER_TICK = 78

interface Palette {
  bg: string
  ruler: string
  rulerText: string
  wave: string
  waveActive: string
  block: string
  blockActive: string
  warn: string
  error: string
  text: string
  playhead: string
}

/**
 * Colours from the stylesheet rather than a second copy here.
 *
 * A canvas cannot use CSS variables directly, so they are read from the DOM.
 * Hard-coded values would be a palette that silently stops matching the first
 * time the theme changes.
 */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback

  return {
    bg: v('--bg2', '#1e2026'),
    ruler: v('--bg3', '#262830'),
    rulerText: v('--text3', '#555a6e'),
    wave: v('--border2', '#3a3d48'),
    waveActive: v('--accent', '#5b7cf6'),
    block: 'rgba(91,124,246,0.16)',
    blockActive: 'rgba(91,124,246,0.34)',
    warn: 'rgba(240,164,48,0.28)',
    error: 'rgba(240,80,80,0.28)',
    text: v('--text2', '#8b8fa8'),
    playhead: v('--red', '#f05050'),
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
  ctx.fill()
}

export default function Timeline() {
  const { subtitles, translations, activeTab } = useSubtitleStore()

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refs rather than state: these change every animation frame, and re-rendering
  // React at 60fps to move a one-pixel line is how a timeline starts dropping
  // frames on a feature-length file.
  const bufferRef = useRef<AudioBuffer | null>(null)
  const peaksRef = useRef<Float32Array>(new Float32Array(0))
  const audioRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const frameRef = useRef(0)
  const playheadRef = useRef(0)

  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState('00:00:00,000')
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // The cues on screen, so the blocks match the tab being edited.
  const cues: Subtitle[] =
    activeTab === 'source' ? subtitles : (translations[activeTab] ?? subtitles)

  // Checked once per change of cues, not once per cue per frame. Drawing runs
  // sixty times a second while playing, and re-running the quality checks over
  // a feature-length track inside that loop is how the playhead starts to
  // stutter on exactly the long files where it matters.
  const quality = useMemo(() => qcTrack(cues), [cues])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const dpr = window.devicePixelRatio || 1
    const W = wrap.clientWidth
    const H = HEIGHT
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const p = readPalette(wrap)
    const span = Math.max(0.1, duration)
    const toPx = (t: number) => (t / span) * W
    const head = playheadRef.current

    ctx.fillStyle = p.bg
    ctx.fillRect(0, 0, W, H)

    // ── Ruler ──
    ctx.fillStyle = p.ruler
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const every = tickEvery(duration, Math.max(2, Math.floor(W / PX_PER_TICK)))
    for (let t = 0; t <= duration; t += every) {
      const x = Math.round(toPx(t))
      ctx.fillStyle = p.rulerText
      ctx.fillRect(x, RULER_H - 5, 1, 5)
      if (x > 2) ctx.fillText(rulerLabel(t), x + 3, RULER_H / 2)
    }

    // ── Waveform ──
    const waveY = RULER_H + BLOCK_H
    const waveH = H - waveY
    const mid = waveY + waveH / 2
    const peaks = peaksRef.current
    if (peaks.length > 0) {
      const BAR = 2
      const STEP = BAR + 1
      const amp = (waveH / 2) * 0.86

      for (let x = 0; x < W; x += STEP) {
        const from = (x / W) * span
        const to = ((x + STEP) / W) * span
        const h = Math.max(1, peakBetween(peaks, span, from, to) * amp)
        // Played audio reads as spent; what is still ahead stays dim.
        ctx.fillStyle = to <= head ? p.waveActive : p.wave
        ctx.fillRect(x, mid - h, BAR, h * 2)
      }
    }

    // ── Cue blocks ──
    cues.forEach(cue => {
      const from = srtToSec(cue.start)
      const to = srtToSec(cue.end)
      const x0 = toPx(from)
      const w = Math.max(3, toPx(to) - x0)
      const active = head >= from && head < to

      const status = quality.get(cue.index)?.status ?? 'ok'
      ctx.fillStyle =
        status === 'error' ? p.error : status === 'warn' ? p.warn : active ? p.blockActive : p.block
      roundRect(ctx, x0, RULER_H + 3, w, BLOCK_H - 6, 5)

      if (w > 26) {
        ctx.fillStyle = p.text
        ctx.font = `${active ? '600' : '500'} 10px system-ui, sans-serif`
        ctx.fillText(`#${cue.index}`, x0 + 6, RULER_H + BLOCK_H / 2)
      }
    })

    // ── Playhead ──
    const x = toPx(head)
    ctx.fillStyle = p.playhead
    ctx.fillRect(x, RULER_H, 1.5, H - RULER_H)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 9, 0)
    ctx.lineTo(x + 9, 7)
    ctx.lineTo(x, 12)
    ctx.closePath()
    ctx.fill()
  }, [cues, duration, quality])

  // Redraw when the cues, the tab, or the available width change.
  useEffect(() => {
    draw()
    const observer = new ResizeObserver(() => draw())
    if (wrapRef.current) observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [draw])

  const stop = useCallback(() => {
    sourceRef.current?.stop()
    sourceRef.current?.disconnect()
    sourceRef.current = null
    cancelAnimationFrame(frameRef.current)
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    const buffer = bufferRef.current
    const audio = audioRef.current
    if (!buffer || !audio) return

    // Past the end, pressing play should start over rather than do nothing.
    const from = offsetRef.current >= buffer.duration ? 0 : offsetRef.current

    const source = audio.createBufferSource()
    source.buffer = buffer
    source.connect(audio.destination)
    source.start(0, from)
    sourceRef.current = source
    startedAtRef.current = audio.currentTime - from
    setPlaying(true)

    const tick = () => {
      const t = audio.currentTime - startedAtRef.current
      if (t >= buffer.duration) {
        playheadRef.current = buffer.duration
        offsetRef.current = buffer.duration
        setClock(clockLabel(buffer.duration))
        stop()
        draw()
        return
      }
      playheadRef.current = t
      offsetRef.current = t
      setClock(clockLabel(t))
      draw()
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [draw, stop])

  const seek = useCallback(
    (seconds: number) => {
      const t = Math.max(0, Math.min(duration, seconds))
      playheadRef.current = t
      offsetRef.current = t
      setClock(clockLabel(t))
      if (playing) stop()
      draw()
    },
    [duration, draw, playing, stop],
  )

  async function load(file: File) {
    setLoading(true)
    setFailed(false)
    try {
      const audio = audioRef.current ?? new AudioContext()
      audioRef.current = audio
      const buffer = await audio.decodeAudioData(await file.arrayBuffer())

      bufferRef.current = buffer
      peaksRef.current = peaksFrom(buffer.getChannelData(0))
      playheadRef.current = 0
      offsetRef.current = 0
      setDuration(buffer.duration)
      setClock(clockLabel(0))
      setName(file.name)
    } catch {
      // A file the browser cannot decode is an ordinary thing to be handed, not
      // an exceptional one. Say so next to the button rather than in a console
      // nobody has open.
      bufferRef.current = null
      peaksRef.current = new Float32Array(0)
      setDuration(0)
      setName(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  // An AudioContext holds an output device. Leaving it open outlives the
  // component and eventually exhausts them.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRef.current)
      sourceRef.current?.stop()
      audioRef.current?.close()
    }
  }, [])

  const ready = duration > 0

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' }}>
        <button
          onClick={() => (playing ? stop() : play())}
          disabled={!ready}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            width: 26, height: 26, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: ready ? 'var(--accent)' : 'var(--bg3)', color: '#fff',
            cursor: ready ? 'pointer' : 'not-allowed', fontSize: 11, lineHeight: 1,
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
          {clock}
          {ready && <span style={{ color: 'var(--text3)' }}> / {clockLabel(duration)}</span>}
        </span>

        <span
          style={{
            fontSize: 11, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: 260,
            color: failed ? 'var(--red)' : 'var(--text3)',
          }}
        >
          {loading
            ? 'Decoding…'
            : failed
              ? 'That file could not be decoded'
              : (name ?? 'No audio loaded')}
        </span>

        <button
          onClick={() => fileRef.current?.click()}
          style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 5, fontSize: 11,
            border: '1px solid var(--border2)', background: 'var(--bg2)',
            color: 'var(--text2)', cursor: 'pointer',
          }}
        >
          Load audio
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) load(f)
          }}
        />
      </div>

      <div
        ref={wrapRef}
        onClick={e => {
          if (!ready) return
          const rect = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - rect.left) / rect.width) * duration)
        }}
        style={{ height: HEIGHT, cursor: ready ? 'pointer' : 'default' }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  )
}
