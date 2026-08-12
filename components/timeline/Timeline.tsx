'use client'

import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { peakBetween, peaksFrom } from '@/lib/audio/peaks'
import { qcTrack, srtToSec } from '@/lib/subtitles'
import { type Edge, hitTest, moveEdge, moveWhole } from '@/lib/timeline/drag'
import { publishPlayhead } from '@/lib/timeline/playhead'
import { clockLabel, rulerLabel, tickEvery } from '@/lib/timeline/ruler'
import {
  type Direction,
  type Transport,
  nextTransport,
  speedLabel,
} from '@/lib/timeline/transport'
import { clampZoom, scrollToShow, visibleWindow } from '@/lib/timeline/view'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle } from '@/types/subtitle'

/**
 * The waveform, the cues, and where we are in the audio.
 *
 * This is the difference between a subtitling tool and a text editor with a
 * timecode column: it is how somebody sees that a cue starts a beat before the
 * line is spoken — invisible in a list, obvious here.
 *
 * The canvas is always the width of the viewport and only the visible seconds
 * are drawn. Widening the canvas with the zoom is the obvious approach and it
 * collapses on real work: placing a boundary to the frame wants roughly 125
 * pixels per second, which over a feature is a canvas hundreds of thousands of
 * pixels wide. Scrolling is a real scrollbar over an empty spacer, so the
 * browser supplies the affordance and we supply only the arithmetic.
 *
 * The audio never leaves the browser. It is decoded locally for drawing and
 * playback, so scrubbing costs nothing and it works on a file that was never
 * uploaded: somebody correcting an SRT against a screener should not have to
 * hand us their video first.
 */

const RULER_H = 18
const BLOCK_H = 38
const HEIGHT = 132

/** Roughly one label per this many pixels, before rounding to a tidy interval. */
const PX_PER_TICK = 78

const ZOOM_STEP = 1.6

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

/** Where the cue blocks live, for deciding what a pointer grabbed. */
const BAND = { top: RULER_H, height: BLOCK_H }

interface Drag {
  index: number
  edge: Edge
  /** Where the pointer went down, in seconds. */
  from: number
  /**
   * The track as it was when the drag began.
   *
   * Every move is computed against this rather than against the cue's current
   * position. Clamping repeatedly against already-moved values lets a drag
   * creep — each frame nudges the limit it was just clamped to.
   */
  track: Subtitle[]
}

export default function Timeline() {
  const { subtitles, translations, activeTab, retimeSubtitle, pushUndo } = useSubtitleStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refs rather than state: these change every animation frame, and re-rendering
  // React at 60fps to move a one-pixel line is how a timeline starts dropping
  // frames on the long files where it earns its place.
  const bufferRef = useRef<AudioBuffer | null>(null)
  const peaksRef = useRef<Float32Array>(new Float32Array(0))
  const audioRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const frameRef = useRef(0)
  const playheadRef = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  const transportRef = useRef<Transport | null>(null)

  /**
   * Where playback started, so the playhead can be derived rather than
   * accumulated.
   *
   * Adding a delta every frame drifts, and at 8x it drifts eight times as fast.
   * The
   * clock is the audio context's, which is the same clock the sound is coming
   * out of — anything else and the picture slides away from what is audible.
   */
  const anchorRef = useRef<{ ctxTime: number; playhead: number; speed: number } | null>(null)

  const [duration, setDuration] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState('00:00:00,000')
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [transport, setTransport] = useState<Transport | null>(null)

  // The cues on screen, so the blocks match the tab being edited.
  const cues: Subtitle[] =
    activeTab === 'source' ? subtitles : (translations[activeTab] ?? subtitles)

  // Checked once per change of cues, not once per cue per frame. Drawing runs
  // sixty times a second while playing, and re-running the quality checks over
  // a feature-length track inside that loop is how the playhead starts to
  // stutter on exactly the files where it matters.
  const quality = useMemo(() => qcTrack(cues), [cues])

  /** The window currently on screen, read from the scroller rather than stored. */
  const currentView = useCallback(() => {
    const el = scrollRef.current
    if (!el) return { start: 0, span: Math.max(0.1, duration) }
    return visibleWindow(duration, el.scrollLeft, el.scrollWidth, el.clientWidth)
  }, [duration])

  /** Pointer position in canvas pixels, and the second it lands on. */
  const pointerAt = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const width = e.currentTarget.clientWidth
      const x = e.clientX - rect.left
      const view = currentView()
      return { x, y: e.clientY - rect.top, at: view.start + (x / width) * view.span }
    },
    [currentView],
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return

    const dpr = window.devicePixelRatio || 1
    const W = scroller.clientWidth
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

    const p = readPalette(scroller)
    const view = currentView()
    const toPx = (t: number) => ((t - view.start) / view.span) * W
    const head = playheadRef.current

    ctx.fillStyle = p.bg
    ctx.fillRect(0, 0, W, H)

    // ── Ruler ──
    ctx.fillStyle = p.ruler
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const every = tickEvery(view.span, Math.max(2, Math.floor(W / PX_PER_TICK)))
    // Started at the first tick inside the window rather than at zero, so the
    // loop does not walk the whole track to reach the visible part.
    const firstTick = Math.floor(view.start / every) * every
    for (let t = firstTick; t <= view.start + view.span; t += every) {
      if (t < 0) continue
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
        const from = view.start + (x / W) * view.span
        const to = view.start + ((x + STEP) / W) * view.span
        const h = Math.max(1, peakBetween(peaks, duration, from, to) * amp)
        // Played audio reads as spent; what is still ahead stays dim.
        ctx.fillStyle = to <= head ? p.waveActive : p.wave
        ctx.fillRect(x, mid - h, BAR, h * 2)
      }
    }

    // ── Cue blocks ──
    cues.forEach(cue => {
      const from = srtToSec(cue.start)
      const to = srtToSec(cue.end)
      // Skipped when off screen: at a deep zoom almost every cue is, and
      // drawing them all is work the viewport throws away.
      if (to < view.start || from > view.start + view.span) return

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
    if (x >= -12 && x <= W + 12) {
      ctx.fillStyle = p.playhead
      ctx.fillRect(x, RULER_H, 1.5, H - RULER_H)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 9, 0)
      ctx.lineTo(x + 9, 7)
      ctx.lineTo(x, 12)
      ctx.closePath()
      ctx.fill()
    }
  }, [cues, currentView, duration, quality])

  // Redraw when the cues, the tab, the zoom or the available width change.
  useEffect(() => {
    draw()
    const observer = new ResizeObserver(() => draw())
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [draw, zoom])

  const stop = useCallback(() => {
    sourceRef.current?.stop()
    sourceRef.current?.disconnect()
    sourceRef.current = null
    anchorRef.current = null
    cancelAnimationFrame(frameRef.current)
    setPlaying(false)
  }, [])

  /** Keep the playhead on screen, without hauling the view away from somebody
   *  who has deliberately scrolled elsewhere to look at something. */
  const follow = useCallback(
    (t: number) => {
      const el = scrollRef.current
      if (!el) return
      const left = scrollToShow(t, currentView(), duration, el.scrollWidth)
      if (left !== null) el.scrollLeft = left
    },
    [currentView, duration],
  )

  /** Play forward with sound, at `speed`. */
  const play = useCallback(
    (speed = 1) => {
      const buffer = bufferRef.current
      const audio = audioRef.current
      if (!buffer || !audio) return

      stop()
      // Past the end, pressing play should start over rather than do nothing.
      const from = playheadRef.current >= buffer.duration ? 0 : playheadRef.current

      const source = audio.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = speed
      source.connect(audio.destination)
      source.start(0, from)
      sourceRef.current = source
      anchorRef.current = { ctxTime: audio.currentTime, playhead: from, speed }
      setPlaying(true)

      const tick = () => {
        const anchor = anchorRef.current
        if (!anchor) return

        const t = anchor.playhead + (audio.currentTime - anchor.ctxTime) * anchor.speed
        if (t >= buffer.duration) {
          playheadRef.current = buffer.duration
          setClock(clockLabel(buffer.duration))
          stop()
          draw()
          return
        }

        playheadRef.current = t
        setClock(clockLabel(t))
        follow(t)
        draw()
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)
    },
    [draw, follow, stop],
  )

  /**
   * Move the playhead without sound.
   *
   * Reverse is silent because it has to be: the Web Audio API rejects a
   * negative playbackRate outright, and reversing a decoded buffer to play it
   * backwards would cost more than the feature is worth. Editors use J to find
   * a moment by eye against the waveform, which this does.
   */
  const scrub = useCallback(
    (direction: Direction, speed: number) => {
      stop()
      setPlaying(true)

      let last: number | null = null
      const step = (now: number) => {
        if (last !== null) {
          const t = playheadRef.current + direction * ((now - last) / 1000) * speed
          playheadRef.current = Math.max(0, Math.min(duration, t))
          setClock(clockLabel(playheadRef.current))
          follow(playheadRef.current)
          draw()

          if (t <= 0 || t >= duration) {
            stop()
            return
          }
        }
        last = now
        frameRef.current = requestAnimationFrame(step)
      }
      frameRef.current = requestAnimationFrame(step)
    },
    [draw, duration, follow, stop],
  )

  const seek = useCallback(
    (seconds: number) => {
      const t = Math.max(0, Math.min(duration, seconds))
      playheadRef.current = t
      setClock(clockLabel(t))
      if (playing) stop()
      draw()
    },
    [duration, draw, playing, stop],
  )

  /**
   * J back, K stop, L forward — and pressing the same key again goes faster.
   *
   * Bound on the window rather than the canvas: a subtitler's hands are on JKL
   * while their eyes are on the text, and requiring the timeline to hold focus
   * first would defeat the point of having it. Skipped while a field has focus,
   * where those keys are letters somebody is typing.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      if (!'jkl'.includes(key) || e.metaKey || e.ctrlKey || e.altKey) return

      const el = e.target as HTMLElement | null
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
      if (duration <= 0) return

      e.preventDefault()

      if (key === 'k') {
        transportRef.current = null
        setTransport(null)
        stop()
        return
      }

      const next = nextTransport(transportRef.current, key === 'l' ? 1 : -1, Date.now())
      transportRef.current = next
      setTransport(next)

      // Forward has sound; backwards cannot, so it scrubs.
      if (next.direction === 1 && bufferRef.current) play(next.speed)
      else scrub(next.direction, next.speed)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration, play, scrub, stop])

  /** Zoom around the playhead, so the thing being worked on stays put. */
  const changeZoom = useCallback(
    (next: number) => {
      const z = clampZoom(next)
      setZoom(z)

      // After the spacer has been laid out at its new width, not before.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el || duration <= 0) return
        const span = duration / z
        const wanted = Math.max(0, Math.min(duration - span, playheadRef.current - span / 2))
        el.scrollLeft = (wanted / duration) * el.scrollWidth
        draw()
      })
    },
    [draw, duration],
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
      anchorRef.current = null
      transportRef.current = null
      setTransport(null)
      setDuration(buffer.duration)
      setZoom(1)
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

  // Lend the playhead to the editor, so splitting a cue can cut where somebody
  // is listening rather than halfway through on principle.
  useEffect(() => {
    publishPlayhead(() => playheadRef.current)
    return () => publishPlayhead(null)
  }, [])

  const ready = duration > 0
  const btn = {
    padding: '3px 8px', borderRadius: 5, fontSize: 11, lineHeight: 1.4,
    border: '1px solid var(--border2)', background: 'var(--bg2)',
    color: 'var(--text2)', cursor: 'pointer',
  } as const

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' }}>
        <button
          onClick={() => {
            transportRef.current = null
            setTransport(null)
            if (playing) stop()
            else play(1)
          }}
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

        {playing && transport && transport.speed !== 1 && (
          <span
            style={{
              fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 4,
              background: 'var(--accent-dim)', color: '#8ba8ff',
            }}
          >
            {speedLabel(transport)}
          </span>
        )}

        <span
          style={{
            fontSize: 11, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: 220,
            color: failed ? 'var(--red)' : 'var(--text3)',
          }}
        >
          {loading
            ? 'Decoding…'
            : failed
              ? 'That file could not be decoded'
              : (name ?? 'No audio loaded')}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            onClick={() => changeZoom(zoom / ZOOM_STEP)}
            disabled={!ready}
            style={btn}
            aria-label="Zoom out"
          >
            −
          </button>
          <span
            style={{
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)',
              minWidth: 40, textAlign: 'center',
            }}
          >
            {zoom.toFixed(1)}×
          </span>
          <button
            onClick={() => changeZoom(zoom * ZOOM_STEP)}
            disabled={!ready}
            style={btn}
            aria-label="Zoom in"
          >
            +
          </button>

          <button onClick={() => fileRef.current?.click()} style={{ ...btn, marginLeft: 6 }}>
            Load audio
          </button>
        </div>

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
        ref={scrollRef}
        onScroll={draw}
        onPointerDown={e => {
          if (!ready) return
          const { x, y, at } = pointerAt(e)
          const grab = hitTest(cues, x, y, e.currentTarget.clientWidth, currentView(), BAND)

          if (!grab) {
            // Outside the cue band, or in a gap: the pointer is asking to move
            // the playhead, not to retime anything.
            seek(at)
            return
          }

          // Marked once, here, rather than on each retime the drag will fire:
          // undoing one pointer move is not undoing anything a person did.
          pushUndo()
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { ...grab, from: at, track: cues }
        }}
        onPointerMove={e => {
          if (!ready) return
          const { x, y, at } = pointerAt(e)
          const drag = dragRef.current

          if (!drag) {
            // Only a cursor change, but it is the whole discoverability of the
            // feature: nothing else says these edges can be pulled.
            const over = hitTest(cues, x, y, e.currentTarget.clientWidth, currentView(), BAND)
            e.currentTarget.style.cursor = !over
              ? 'pointer'
              : over.edge === 'body'
                ? 'grab'
                : 'col-resize'
            return
          }

          const cue = drag.track[drag.index]
          const next =
            drag.edge === 'body'
              ? moveWhole(drag.track, drag.index, at - drag.from, { duration })
              : moveEdge(drag.track, drag.index, drag.edge, at, { duration })

          if (next && (next.start !== cue.start || next.end !== cue.end)) {
            retimeSubtitle(cue.index, next.start, next.end)
          }
        }}
        onPointerUp={e => {
          dragRef.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        style={{
          height: HEIGHT, overflowX: 'auto', overflowY: 'hidden',
          cursor: ready ? 'pointer' : 'default',
          touchAction: 'none',
        }}
      >
        {/* Empty, and there only to give the scrollbar something to measure. */}
        <div style={{ width: `${zoom * 100}%`, height: HEIGHT, position: 'relative' }}>
          <canvas ref={canvasRef} style={{ display: 'block', position: 'sticky', left: 0, top: 0 }} />
        </div>
      </div>
    </div>
  )
}
