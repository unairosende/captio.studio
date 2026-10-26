'use client'

import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import Caption from '@/components/video/Caption'
import { decodeAudio, mediaType } from '@/lib/audio/decode'
import { packPeaks, peakBetween } from '@/lib/audio/peaks'
import { DEFAULT_FPS, cueAt, qcTrack, srtToSec } from '@/lib/subtitles'
import { type Grab, hitTest, moveEdge, moveWhole } from '@/lib/timeline/drag'
import { publishPlayhead, publishSeek } from '@/lib/timeline/playhead'
import { clockLabel, rulerLabel, tickEvery } from '@/lib/timeline/ruler'
import {
  type Direction,
  type Transport,
  nextTransport,
  speedLabel,
} from '@/lib/timeline/transport'
import { anchoredStart, clampZoom, scrollToShow, visibleWindow, wheelZoom } from '@/lib/timeline/view'
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
 * their video first — and a file loaded here is the one Transcribir sends.
 *
 * The picture is drawn in the editor's viewer, to the right of the table,
 * through a portal: the element stays this component's, because it is the
 * clock, and goes where the screen has room for it.
 */

/** The viewer's load button, which the Transcribir step presses when it has nothing to send. */
export const LOAD_MEDIA = 'Cargar el vídeo o el audio de la secuencia'

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

/** How far a press travels before it is a drag rather than a click. */
const DRAG_PX = 4

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

/**
 * What a press on the timeline is, decided by where it lands and whether it
 * moves.
 *
 * The ruler is the playhead's handle: pressing puts the head there, dragging
 * drags it. Everywhere else a press that never moves is a click — the head
 * goes where it landed — and one that moves is a drag: of the cue it landed
 * on, or of the view itself, the way a map is dragged.
 */
type Press =
  | { kind: 'ruler' }
  | { kind: 'wave'; x: number; left: number; moved: boolean }
  | {
      kind: 'cue'
      grab: Grab
      x: number
      /** Where the pointer went down, in seconds. */
      from: number
      /**
       * The track as it was when the drag began.
       *
       * Every move is computed against this rather than against the cue's
       * current position. Clamping repeatedly against already-moved values
       * lets a drag creep — each frame nudges the limit it was just clamped to.
       */
      track: Subtitle[]
      moved: boolean
    }

/**
 * Remounted on new material, so every piece of state — duration, zoom, the
 * playhead, the element's own buffer — starts over with the file rather than
 * being reset one by one in an effect.
 */
export default function Timeline({ screen }: { screen: HTMLElement | null }) {
  const playback = useSubtitleStore(s => s.playback)
  return <Track key={playback?.url ?? ''} playback={playback} screen={screen} />
}

function Track({ playback, screen }: { playback: Playback | null; screen: HTMLElement | null }) {
  const { subtitles, translations, activeTab, retimeSubtitle, pushUndo, setPlayback, select } =
    useSubtitleStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Refs rather than state: these change every animation frame, and re-rendering
  // React at 60fps to move a one-pixel line is how a timeline starts dropping
  // frames on the long files where it earns its place.
  const peaksRef = useRef<Float32Array>(Float32Array.from(playback?.peaks ?? []))
  const frameRef = useRef(0)
  const playheadRef = useRef(0)
  const pressRef = useRef<Press | null>(null)
  /** The zoom as last applied, which a pinch compounds on between renders. */
  const zoomRef = useRef(1)
  const transportRef = useRef<Transport | null>(null)
  /** When the picture was last told where a backwards scrub had got to. */
  const scrubSeekRef = useRef(0)
  /** The cue under the picture, as last shown — so state changes only at a boundary. */
  const activeRef = useRef<number | null>(null)
  /** Somebody scrolled the table while it played: they are reading, leave it. */
  const tableFreeRef = useRef(false)

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

  /**
   * Make a cue the editor's selection, with its row in view.
   *
   * Following playback keeps the row in the middle of the table, so what is
   * coming is on screen; a click only brings it into view, so the table does
   * not jump under a pointer that was just used on it. Neither happens while
   * somebody is typing in a field — following the audio must never take the
   * text out from under the caret — nor for a row the table is not showing:
   * filtered out, there is nothing to bring into view, and selecting it unseen
   * would send ↑↓ somewhere unexpected.
   */
  const reveal = useCallback(
    (index: number, how: 'follow' | 'jump') => {
      const focus = document.activeElement as HTMLElement | null
      if (focus?.tagName === 'TEXTAREA' || focus?.tagName === 'INPUT' || focus?.isContentEditable) return
      const row = document.querySelector<HTMLElement>(`.cue[data-cue="${index}"]`)
      if (!row) return
      select(index)
      row.scrollIntoView(how === 'follow' ? { block: 'center', behavior: 'smooth' } : { block: 'nearest' })
    },
    [select],
  )

  const showCue = useCallback(
    (t: number, how: 'follow' | 'jump' = 'jump') => {
      const index = cueAt(cues, t)?.index ?? null
      if (index !== activeRef.current) {
        activeRef.current = index
        setActiveIndex(index)
        // A gap between lines leaves the last one selected rather than none.
        if (index !== null && (how === 'jump' || !tableFreeRef.current)) reveal(index, how)
      }
    },
    [cues, reveal],
  )

  // Somebody wheeling through the table during playback is reading something
  // else; following picks up again with the next play.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.cues')) tableFreeRef.current = true
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

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

  // The loops below run for as long as playback does, but a closure keeps the
  // drawing and the cues of the moment it started: an edit or a selection
  // made mid-play would not show until the next press. They read these.
  const live = useRef({ draw, showCue })
  useEffect(() => {
    live.current = { draw, showCue }
  }, [draw, showCue])

  /** Play forward with sound, at `speed`. */
  const play = useCallback(
    (speed = 1) => {
      const video = videoRef.current
      if (!video || duration <= 0) return

      stop()
      tableFreeRef.current = false
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
        live.current.showCue(t, 'follow')
        live.current.draw()
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
    [duration, follow, stop],
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
      tableFreeRef.current = false
      setPlaying(true)

      let last: number | null = null
      const step = (now: number) => {
        if (last !== null) {
          const t = playheadRef.current + direction * ((now - last) / 1000) * speed
          playheadRef.current = Math.max(0, Math.min(duration, t))
          setClock(clockLabel(playheadRef.current))
          follow(playheadRef.current)
          live.current.showCue(playheadRef.current, 'follow')
          live.current.draw()

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
    [duration, follow, stop],
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

  /** K is down, so J and L step a frame instead of running. */
  const kHeldRef = useRef(false)
  /** J or L is held under K, creeping at a quarter speed. */
  const creepRef = useRef(false)

  /**
   * The transport keys.
   *
   * Bound on the window rather than the canvas: a subtitler's hands are on
   * them while their eyes are on the text, and requiring the timeline to hold
   * focus first would defeat the point of having them.
   *
   * J back, K stop, L forward, and the same key again goes faster — Avid's and
   * Premiere's, so a subtitler arrives already able to use them. With K held,
   * J and L step one frame, and held themselves creep: the way to find the
   * frame a word starts on. Space plays and stops, as everywhere else.
   *
   * In a field these are letters and a space somebody is typing, so there
   * they need ⌥ — which is what lets a line be corrected while it is heard.
   * Read by position rather than by character, since ⌥ turns them into ∆, ˚
   * and ¬ on a Mac.
   */
  useEffect(() => {
    const KEYS: Record<string, 'j' | 'k' | 'l' | ' '> = { KeyJ: 'j', KeyK: 'k', KeyL: 'l', Space: ' ' }

    const halt = () => {
      transportRef.current = null
      setTransport(null)
      stop()
    }

    function onKey(e: KeyboardEvent) {
      const key = KEYS[e.code]
      if (!key || e.metaKey || e.ctrlKey || duration <= 0) return
      const el = e.target as HTMLElement | null
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (e.altKey ? key === ' ' : typing) return
      // A focused button answers Space itself; taking the key from it would
      // leave somebody on the keyboard unable to press anything.
      if (key === ' ' && el?.closest('button, a, select, [role="button"], [role="menuitem"], [role="tab"]')) return

      e.preventDefault()

      if (key === ' ') {
        if (e.repeat) return
        if (playing) halt()
        else {
          halt()
          play(1)
        }
        return
      }

      if (key === 'k') {
        kHeldRef.current = true
        if (!e.repeat) halt()
        return
      }

      const direction: Direction = key === 'l' ? 1 : -1

      if (kHeldRef.current) {
        if (!e.repeat) {
          halt()
          seek((Math.round(playheadRef.current * DEFAULT_FPS) + direction) / DEFAULT_FPS)
        } else if (!creepRef.current) {
          creepRef.current = true
          setTransport({ direction, speed: 0.25, at: Date.now() })
          if (direction === 1) play(0.25)
          else scrub(direction, 0.25)
        }
        return
      }

      // Holding L down is not pressing it eight times.
      if (e.repeat) return

      const next = nextTransport(transportRef.current, direction, Date.now())
      transportRef.current = next
      setTransport(next)

      // Forward has sound; backwards cannot, so it scrubs.
      if (next.direction === 1) play(next.speed)
      else scrub(next.direction, next.speed)
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'KeyK') kHeldRef.current = false
      if (creepRef.current && (e.code === 'KeyK' || e.code === 'KeyJ' || e.code === 'KeyL')) {
        creepRef.current = false
        halt()
      }
    }

    // A key let go in another window never says so here.
    function onBlur() {
      kHeldRef.current = false
      if (creepRef.current) {
        creepRef.current = false
        halt()
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [duration, play, playing, scrub, seek, stop])

  /**
   * Zoom with one moment held still: the second under the pointer for a
   * pinch, the playhead in the middle for the buttons.
   *
   * Laid out here and now rather than on React's next render. A pinch fires
   * sixty times a second, and each step has to start from where the last one
   * left the view — compounding on a stale zoom is what makes a pinch lurch.
   */
  const changeZoom = useCallback(
    (next: number, anchor?: { x: number; at: number }) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track || duration <= 0) return
      const z = clampZoom(next)
      zoomRef.current = z
      track.style.width = `${z * 100}%`
      const { x, at } = anchor ?? { x: el.clientWidth / 2, at: playheadRef.current }
      // Reading scrollWidth lays the spacer out at its new width first.
      el.scrollLeft = (anchoredStart(duration, z, at, x, el.clientWidth) / duration) * el.scrollWidth
      setZoom(z)
      draw()
    },
    [draw, duration],
  )

  /**
   * The wheel, the trackpad and the pinch.
   *
   * Sideways is the browser's own scroll, momentum and all. A vertical wheel
   * means sideways too — the wave has nothing to scroll up and down, and a
   * mouse has no other way to move along it. ⌘ or a pinch zooms where the
   * pointer is. Bound by hand rather than through React, whose wheel listener
   * is passive and cannot stop the browser zooming the whole page instead.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || duration <= 0) return

    /** The zoom when a Safari pinch began; the gesture reports scale against it. */
    let pinch: number | null = null
    const anchor = (clientX: number) => {
      const x = clientX - el.getBoundingClientRect().left
      const view = currentView()
      return { x, at: view.start + (x / el.clientWidth) * view.span }
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (pinch === null) changeZoom(zoomRef.current * wheelZoom(e.deltaY, e.deltaMode), anchor(e.clientX))
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      }
    }
    // Safari reports a pinch as a gesture of its own rather than as a wheel.
    type Gesture = Event & { scale: number; clientX: number }
    const onGestureStart = (e: Event) => { e.preventDefault(); pinch = zoomRef.current }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (pinch !== null) changeZoom(pinch * (e as Gesture).scale, anchor((e as Gesture).clientX))
    }
    const onGestureEnd = (e: Event) => { e.preventDefault(); pinch = null }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [changeZoom, currentView, duration])

  /**
   * A file from disk, for a sequence whose upload is elsewhere or nowhere.
   *
   * Goes through the store like a file from the bucket does, so there is one
   * way for the timeline to receive material. Decoded here for the waveform;
   * a file the platform cannot decode still gets handed to the <video>, which
   * may manage the picture even so, and says under it if it cannot. The file
   * goes along, for Transcribir to send as it is.
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
      file,
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

  // And lend the way back, so the palette and the table can jump to a cue or
  // a timecode — bringing the wave along, since the place jumped to may be
  // well off the zoomed-in stretch on screen.
  useEffect(() => {
    publishSeek(t => {
      seek(t)
      follow(t)
    })
    return () => publishSeek(null)
  }, [follow, seek])

  const ready = duration > 0

  // What the viewer holds: the picture with the line on it and the file it
  // comes from, or the way to load one. Audio gets the picture too — black,
  // with the cue as it will read over footage — rather than an empty column.
  // The box is 16:9 whatever plays in it; vertical footage pillarboxes.
  const viewer = playback ? (
    <>
      <div className={`picture ${s.screen}`}>
        <video
          ref={videoRef}
          src={playback.url}
          preload="metadata"
          playsInline
          onLoadedMetadata={e => {
            if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration)
          }}
          onError={() => setFailed(true)}
        />
        <Caption text={active?.text} />
      </div>
      <div className={s.source}>
        <span title={playback.filename} data-tone={failed ? 'danger' : undefined}>
          {failed ? 'Ese archivo no se pudo reproducir' : playback.filename}
        </span>
        <button className="btn btn-quiet" data-cmd={LOAD_MEDIA} aria-busy={loading || undefined} onClick={() => fileRef.current?.click()}>Cambiar</button>
      </div>
    </>
  ) : (
    <div className={s.idle}>
      <div className="empty">
        <span className="empty-title">Sin vídeo ni audio</span>
        <p>Carga el de la secuencia: se ve aquí con la cue encima, su onda sale abajo para cuadrar tiempos y se transcribe sin volver a elegirlo.</p>
        <button className="btn btn-primary" data-cmd={LOAD_MEDIA} aria-busy={loading || undefined} onClick={() => fileRef.current?.click()}>Cargar vídeo o audio</button>
      </div>
    </div>
  )

  return (
    <div className="transport">
      {screen && createPortal(viewer, screen)}

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
          data-cmd-hint="Espacio"
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

        <div className="transport-tools">
          <button className="btn btn-quiet" onClick={() => changeZoom(zoom / ZOOM_STEP)} disabled={!ready} aria-label="Alejar">−</button>
          <span className="transport-zoom">{zoom.toFixed(1)}×</span>
          <button className="btn btn-quiet" onClick={() => changeZoom(zoom * ZOOM_STEP)} disabled={!ready} aria-label="Acercar">+</button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={draw}
        onPointerDown={e => {
          const { x, y, at } = pointerAt(e)
          // Below clientHeight is the scrollbar, which is the browser's.
          if (!ready || e.button !== 0 || y > e.currentTarget.clientHeight) return
          e.currentTarget.setPointerCapture(e.pointerId)

          if (y < RULER_H) {
            pressRef.current = { kind: 'ruler' }
            seek(at)
            return
          }
          const grab = hitTest(cues, x, y, e.currentTarget.clientWidth, currentView(), BAND)
          pressRef.current = grab
            ? { kind: 'cue', grab, x, from: at, track: cues, moved: false }
            : { kind: 'wave', x, left: e.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={e => {
          if (!ready) return
          const el = e.currentTarget
          const { x, y, at } = pointerAt(e)
          const press = pressRef.current

          if (!press) {
            // Only a cursor change, but it is the whole discoverability of the
            // feature: nothing else says these edges can be pulled, or that
            // the wave itself can be dragged along.
            const over = y < RULER_H ? null : hitTest(cues, x, y, el.clientWidth, currentView(), BAND)
            el.style.cursor = over
              ? over.edge === 'body' ? 'grab' : 'col-resize'
              : y >= RULER_H && el.scrollWidth > el.clientWidth ? 'grab' : 'pointer'
            return
          }

          if (press.kind === 'ruler') {
            seek(at)
            return
          }
          if (!press.moved) {
            if (Math.abs(x - press.x) < DRAG_PX) return
            press.moved = true
            // Marked once, on the first real move rather than on the press or
            // on each retime: a press that never moves is a click, and undoing
            // a click — or one pointer move — is undoing nothing anyone did.
            if (press.kind === 'cue') pushUndo()
          }

          if (press.kind === 'wave') {
            // One to one: the second that was under the pointer stays under it.
            el.style.cursor = 'grabbing'
            el.scrollLeft = press.left - (x - press.x)
            return
          }

          const { grab, track } = press
          const cue = track[grab.index]
          const next =
            grab.edge === 'body'
              ? moveWhole(track, grab.index, at - press.from, { duration })
              : moveEdge(track, grab.index, grab.edge, at, { duration })

          if (next && (next.start !== cue.start || next.end !== cue.end)) {
            retimeSubtitle(cue.index, next.start, next.end)
          }
        }}
        onPointerUp={e => {
          const press = pressRef.current
          pressRef.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
          if (!press || press.kind === 'ruler' || press.moved) return
          // A press that never moved: the playhead goes where it landed, and a
          // cue pressed becomes the editor's selection, its row brought into view.
          seek(pointerAt(e).at)
          if (press.kind === 'cue') reveal(press.track[press.grab.index].index, 'jump')
        }}
        onPointerCancel={() => {
          pressRef.current = null
        }}
        className={s.scroll}
        data-ready={ready || undefined}
        style={{ '--wave-h': `${HEIGHT}px` } as CSSProperties}
      >
        {/* Empty, and there only to give the scrollbar something to measure. */}
        <div ref={trackRef} className={s.track} style={{ width: `${zoom * 100}%` }}>
          <canvas ref={canvasRef} className={s.canvas} />
        </div>
      </div>
    </div>
  )
}
