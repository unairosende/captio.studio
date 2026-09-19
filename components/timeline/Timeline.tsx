'use client'

import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Caption from '@/components/video/Caption'
import { decodeAudio, mediaType } from '@/lib/audio/decode'
import { packPeaks, peakBetween } from '@/lib/audio/peaks'
import { cueAt, qcTrack, srtToSec } from '@/lib/subtitles'
import { type Edge, hitTest, moveEdge, moveWhole } from '@/lib/timeline/drag'
import { publishPlayhead, publishSeek } from '@/lib/timeline/playhead'
import { clockLabel, rulerLabel, tickEvery } from '@/lib/timeline/ruler'
import {
  type Direction,
  type Transport,
  nextTransport,
  speedLabel,
} from '@/lib/timeline/transport'
import { clampZoom, scrollToShow, visibleWindow } from '@/lib/timeline/view'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Playback } from '@/types/media'
import type { Subtitle } from '@/types/subtitle'

import s from './timeline.module.css'

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
 * Playback is a <video> element, whatever the file: it decodes what the platform
 * decodes, plays audio-only files as happily, and reads a file in the bucket
 * through a signed URL with range requests, so nothing is downloaded that is
 * not watched. The element is also the clock — the playhead is read off it
 * every frame rather than accumulated, so it cannot drift from what is heard.
 *
 * The waveform comes from peaks, not from the bytes: computed once when the
 * file was uploaded and saved with it, or here and now for a file somebody
 * hands the timeline from disk. That second path still exists on purpose:
 * somebody correcting an SRT against a screener should not have to upload
 * their video first.
 */

const RULER_H = 18
const BLOCK_H = 38
// The waveform is the instrument timing depends on — direction B's own words
// for it — so it gets the room to read as one, not a thin strip under the
// ruler and the cue blocks. Everything below (amplitude, hit-testing bands)
// derives from this one number.
const HEIGHT = 196

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
 * A canvas cannot use CSS variables directly, and reading them with
 * getPropertyValue hands back the token unresolved — with the redesign's
 * light-dark() pairs, literally the text "light-dark(…)". So each token is
 * assigned to a probe element's colour and read back computed, which is the
 * one place the browser resolves it for the theme in force.
 */
function readPalette(el: HTMLElement): Palette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  el.appendChild(probe)
  const v = (name: string, fallback: string) => {
    probe.style.color = `var(${name}, ${fallback})`
    return getComputedStyle(probe).color || fallback
  }
  const mix = (name: string, pct: number, fallback: string) => {
    probe.style.color = `color-mix(in srgb, var(${name}, ${fallback}) ${pct}%, transparent)`
    return getComputedStyle(probe).color || fallback
  }
  const palette: Palette = {
    bg: v('--s1', '#1c1c1f'),
    ruler: v('--s2', '#232327'),
    rulerText: v('--ink-3', '#83827c'),
    wave: v('--ink-3', '#83827c'),
    waveActive: v('--ink', '#ecebe6'),
    block: mix('--ink', 12, '#ecebe6'),
    blockActive: mix('--ink', 28, '#ecebe6'),
    warn: mix('--warn', 30, '#e6c15a'),
    error: mix('--danger', 30, '#ff6f5e'),
    text: v('--ink-2', '#a3a19a'),
    playhead: v('--ink', '#ecebe6'),
  }
  probe.remove()
  return palette
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

/**
 * Remounted on new material, so every piece of state — duration, zoom, the
 * playhead, the element's own buffer — starts over with the file rather than
 * being reset one by one in an effect.
 */
export default function Timeline() {
  const playback = useSubtitleStore(s => s.playback)
  return <Track key={playback?.url ?? ''} playback={playback} />
}

function Track({ playback }: { playback: Playback | null }) {
  const { subtitles, translations, activeTab, retimeSubtitle, pushUndo, setPlayback } =
    useSubtitleStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Refs rather than state: these change every animation frame, and re-rendering
  // React at 60fps to move a one-pixel line is how a timeline starts dropping
  // frames on the long files where it earns its place.
  const peaksRef = useRef<Float32Array>(Float32Array.from(playback?.peaks ?? []))
  const frameRef = useRef(0)
  const playheadRef = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  const transportRef = useRef<Transport | null>(null)
  /** When the picture was last told where a backwards scrub had got to. */
  const scrubSeekRef = useRef(0)
  /** The cue under the picture, as last shown — so state changes only at a boundary. */
  const activeRef = useRef<number | null>(null)

  // Provisional until the element has read the header: enough to draw the
  // peaks at once rather than after the first range request.
  const [duration, setDuration] = useState(playback?.durationSeconds ?? 0)
  const [zoom, setZoom] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState('00:00:00,000')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [transport, setTransport] = useState<Transport | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  // The cues on screen, so the blocks match the tab being edited.
  const cues: Subtitle[] =
    activeTab === 'source' ? subtitles : (translations[activeTab] ?? subtitles)

  // Checked once per change of cues, not once per cue per frame. Drawing runs
  // sixty times a second while playing, and re-running the quality checks over
  // a feature-length track inside that loop is how the playhead starts to
  // stutter on exactly the files where it matters.
  const quality = useMemo(() => qcTrack(cues), [cues])

  // Held as an index and looked up here, so a line being retyped changes under
  // the picture as it is typed rather than at the next cue boundary.
  const active = activeIndex === null ? null : (cues.find(c => c.index === activeIndex) ?? null)

  const showCue = useCallback(
    (t: number) => {
      const index = cueAt(cues, t)?.index ?? null
      if (index !== activeRef.current) {
        activeRef.current = index
        setActiveIndex(index)
      }
    },
    [cues],
  )

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

  // Redraw when the cues, the tab, the zoom, the available width or the theme
  // change. The palette is read on every draw, so a theme switch only needs a
  // reason to draw: the attribute the toggle stamps on <html>, and the system
  // preference for when nothing is stamped. Without these the wave kept the
  // old theme's colours until the next scroll.
  useEffect(() => {
    draw()
    const size = new ResizeObserver(() => draw())
    if (scrollRef.current) size.observe(scrollRef.current)
    const theme = new MutationObserver(() => draw())
    theme.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', draw)
    return () => {
      size.disconnect()
      theme.disconnect()
      system.removeEventListener('change', draw)
    }
  }, [draw, zoom])

  const stop = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.pause()
      // After a backwards scrub the picture is behind the playhead by up to a
      // seek interval; after playing, they already agree and this is a no-op.
      if (Math.abs(video.currentTime - playheadRef.current) > 0.05) {
        video.currentTime = playheadRef.current
      }
    }
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
      const video = videoRef.current
      if (!video || duration <= 0) return

      stop()
      // Past the end, pressing play should start over rather than do nothing.
      if (playheadRef.current >= duration) playheadRef.current = 0
      if (Math.abs(video.currentTime - playheadRef.current) > 0.05) {
        video.currentTime = playheadRef.current
      }
      video.playbackRate = speed
      // Refused only by an autoplay policy, and every path here is a key or a
      // click; the tick below notices the element still paused and stops.
      void video.play().catch(() => {})
      setPlaying(true)

      const tick = () => {
        const t = video.currentTime
        playheadRef.current = t
        setClock(clockLabel(t))
        follow(t)
        showCue(t)
        draw()
        // Ended, or paused by something that is not us — a media key, the
        // element losing its source — and the button should say so.
        if (video.ended || video.paused) {
          stop()
          return
        }
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)
    },
    [draw, duration, follow, showCue, stop],
  )

  /**
   * Move the playhead backwards, without sound.
   *
   * Reverse is silent because it has to be: no browser plays media at a
   * negative rate. Editors use J to find a moment by eye against the waveform,
   * which this does, and the picture follows at a walking pace — a seek every
   * frame stalls the decoder, a seek every few frames reads as scrubbing.
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
          showCue(playheadRef.current)
          draw()

          const video = videoRef.current
          if (video && now - scrubSeekRef.current > 120) {
            video.currentTime = playheadRef.current
            scrubSeekRef.current = now
          }

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
    [draw, duration, follow, showCue, stop],
  )

  const seek = useCallback(
    (seconds: number) => {
      const t = Math.max(0, Math.min(duration, seconds))
      playheadRef.current = t
      setClock(clockLabel(t))
      if (playing) stop()
      const video = videoRef.current
      if (video) video.currentTime = t
      showCue(t)
      draw()
    },
    [duration, draw, playing, showCue, stop],
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
      if (next.direction === 1) play(next.speed)
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

  /**
   * A file from disk, for a sequence whose upload is elsewhere or nowhere.
   *
   * Goes through the store like a file from the bucket does, so there is one
   * way for the timeline to receive material. Decoded here for the waveform;
   * a file the platform cannot decode still gets handed to the <video>, which
   * may manage the picture even so, and says next to the button if it cannot.
   */
  async function load(file: File) {
    setLoading(true)
    const decoded = await decodeAudio(file)
    setPlayback({
      url: URL.createObjectURL(file),
      contentType: mediaType(file),
      filename: file.name,
      durationSeconds: decoded?.duration ?? null,
      peaks: decoded ? packPeaks(decoded.peaks) : [],
    })
    setLoading(false)
  }

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  // Lend the playhead to the editor, so splitting a cue can cut where somebody
  // is listening rather than halfway through on principle.
  useEffect(() => {
    publishPlayhead(() => playheadRef.current)
    return () => publishPlayhead(null)
  }, [])

  // And lend the way back, so the palette can jump to a cue or a timecode.
  useEffect(() => {
    publishSeek(seek)
    return () => publishSeek(null)
  }, [seek])

  const ready = duration > 0
  const hasVideo = playback?.contentType.startsWith('video/') ?? false

  return (
    <div className="transport">
      {/*
        Always in the tree, because it is the player for audio-only files too;
        only shown when there is a picture to show. Pane width is fixed and the
        footage letterboxes inside it: an aspect-ratio box stretched to the
        row's height is a layout question with different answers per browser.
      */}
      <div className="transport-video picture" hidden={!hasVideo}>
        <video
          ref={videoRef}
          src={playback?.url}
          preload="metadata"
          playsInline
          onLoadedMetadata={e => {
            if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration)
          }}
          onError={() => setFailed(true)}
        />
        <Caption text={active?.text} />
      </div>

      <div className="transport-main">
      <div className="transport-bar">
        <button
          className="btn"
          onClick={() => {
            transportRef.current = null
            setTransport(null)
            if (playing) stop()
            else play(1)
          }}
          disabled={!ready}
          aria-label={playing ? 'Pausa' : 'Reproducir'}
          data-cmd={playing ? 'Pausar' : 'Reproducir'}
          data-cmd-hint="K"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <span className="transport-clock">
          {clock}
          {ready && <span className="muted"> / {clockLabel(duration)}</span>}
        </span>

        {playing && transport && transport.speed !== 1 && (
          <span className="kbd">{speedLabel(transport)}</span>
        )}

        <span className={failed ? 'err' : 'muted'} title={playback?.filename}>
          {loading
            ? 'Descodificando…'
            : failed
              ? 'Ese archivo no se pudo reproducir'
              : (playback?.filename || 'Sin vídeo ni audio — carga el de la secuencia para cuadrar tiempos')}
        </span>

        <div className="transport-tools">
          <button className="btn btn-quiet" onClick={() => changeZoom(zoom / ZOOM_STEP)} disabled={!ready} aria-label="Alejar">−</button>
          <span className="transport-zoom">{zoom.toFixed(1)}×</span>
          <button className="btn btn-quiet" onClick={() => changeZoom(zoom * ZOOM_STEP)} disabled={!ready} aria-label="Acercar">+</button>
          <button className={ready ? 'btn' : 'btn btn-primary'} data-cmd="Cargar el vídeo o el audio de la secuencia" onClick={() => fileRef.current?.click()}>
            {ready ? 'Cambiar archivo' : 'Cargar vídeo o audio'}
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
        className={s.scroll}
        data-ready={ready || undefined}
        style={{ '--wave-h': `${HEIGHT}px` } as CSSProperties}
      >
        {/* Empty, and there only to give the scrollbar something to measure. */}
        <div className={s.track} style={{ width: `${zoom * 100}%` }}>
          <canvas ref={canvasRef} className={s.canvas} />
        </div>
      </div>
      </div>
    </div>
  )
}
