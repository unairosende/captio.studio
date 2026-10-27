'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

import s from './editor.module.css'
import { GripIcon, MaximizeIcon, MinimizeIcon, PanelRightIcon, RestoreIcon } from './icons'

/** Docked to the right, floating over the table, filling the table's room, or folded away. */
export type ViewerMode = 'open' | 'float' | 'max' | 'folded'

/**
 * Where the floating viewer sits: its distance from the window's right and
 * bottom edges, and its width — the height follows, the picture being 16:9.
 * Measured from the corner it starts in, so a window made smaller keeps it
 * in that corner rather than pushing it off the far side.
 */
interface Spot {
  right: number
  bottom: number
  width: number
}

/**
 * The viewer's own layout, not the sequence's: kept in this browser, like the
 * wave's height. A browser that refuses storage still moves it; it only
 * forgets on reload.
 */
const SPOT_KEY = 'captio.viewer'
const MIN_W = 200
/** Clear of the window's edges, and of the editor's header. */
const EDGE = 8
const HEAD = 44
const STEP = 16
const LEAP = 64

function readSpot(): Spot | null {
  try {
    const v = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null') as Partial<Spot> | null
    return v && [v.right, v.bottom, v.width].every(Number.isFinite) ? (v as Spot) : null
  } catch {
    return null
  }
}

function writeSpot(spot: Spot) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spot))
  } catch {}
}

/** Kept whole inside the window. `height` is what the box will measure at this width. */
function fit(spot: Spot, height: number): Spot {
  const width = Math.round(Math.min(Math.max(spot.width, MIN_W), window.innerWidth - 2 * EDGE))
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, EDGE), Math.max(EDGE, max)))
  return {
    width,
    right: clamp(spot.right, window.innerWidth - width - EDGE),
    bottom: clamp(spot.bottom, window.innerHeight - height - HEAD - EDGE),
  }
}

/**
 * The picture, and the bar that decides where it goes.
 *
 * Docked it is a column to the right of the table. Floating it is a window
 * of its own: carried by its bar — or by the grip in it, with the arrows —
 * anywhere on screen, and made bigger or smaller from its top-left corner,
 * the one that faces the table when it sits in its usual place. Maximised it
 * takes the table's room. Folded it stays in the tree: the <video> inside is
 * the timeline's clock, and keeps sounding.
 */
export default function Viewer({ mode, onMode, onScreen }: {
  mode: ViewerMode
  onMode: (mode: ViewerMode) => void
  /** Where the timeline draws the picture. */
  onScreen: (el: HTMLElement | null) => void
}) {
  const ref = useRef<HTMLElement>(null)
  // The server has no storage and reads null. Harmless: the first render is
  // never the floating box, which is all the spot draws.
  const [spot, setSpot] = useState<Spot | null>(() => (typeof window === 'undefined' ? null : readSpot()))

  const grab = useRef<{ x: number; y: number; from: Spot } | null>(null)
  const floating = mode === 'float'

  /** Where it is now; measured, for the first move out of its default corner. */
  const current = (): Spot => {
    if (spot) return spot
    const r = ref.current!.getBoundingClientRect()
    return { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, width: r.width }
  }
  /** The box's height at another width: the bar stays, the picture scales. */
  const heightAt = (width: number) => {
    const el = ref.current!
    return el.offsetHeight + (width - el.offsetWidth) * 9 / 16
  }
  const place = (next: Spot, save = false) => {
    const fitted = fit(next, heightAt(next.width))
    setSpot(fitted)
    if (save) writeSpot(fitted)
  }

  // A window made smaller pulls it back inside rather than leaving it half off.
  useEffect(() => {
    if (!floating || !spot) return
    const refit = () => setSpot(sp => sp && fit(sp, ref.current?.offsetHeight ?? 0))
    window.addEventListener('resize', refit)
    return () => window.removeEventListener('resize', refit)
  }, [floating, spot])

  const start = (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    grab.current = { x: e.clientX, y: e.clientY, from: current() }
  }
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!grab.current) return
    grab.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (spot) writeSpot(spot)
  }

  const onMoveKey = (e: KeyboardEvent<HTMLElement>) => {
    const d = e.shiftKey ? LEAP : STEP
    const sp = current()
    if (e.key === 'ArrowLeft') place({ ...sp, right: sp.right + d }, true)
    else if (e.key === 'ArrowRight') place({ ...sp, right: sp.right - d }, true)
    else if (e.key === 'ArrowUp') place({ ...sp, bottom: sp.bottom + d }, true)
    else if (e.key === 'ArrowDown') place({ ...sp, bottom: sp.bottom - d }, true)
    else return
    e.preventDefault()
  }
  // The corner is the top-left one, so towards the top-left is bigger.
  const onSizeKey = (e: KeyboardEvent<HTMLElement>) => {
    const d = e.shiftKey ? LEAP : STEP
    const sp = current()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') place({ ...sp, width: sp.width + d }, true)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') place({ ...sp, width: sp.width - d }, true)
    else return
    e.preventDefault()
  }

  const placed = floating && spot
    ? { '--right': `${spot.right}px`, '--bottom': `${spot.bottom}px`, '--w': `${spot.width}px` } as CSSProperties
    : undefined

  return (
    <aside ref={ref} className={s.viewer} hidden={mode === 'folded'} aria-label="Visor" data-placed={placed ? '' : undefined} style={placed}>
      <div
        className={s.paneHead}
        data-movable={floating || undefined}
        onPointerDown={e => {
          // Pressing one of the bar's buttons is pressing it, not picking the viewer up.
          if (!floating || e.button !== 0 || (e.target as Element).closest('button:not([data-grip])')) return
          start(e)
        }}
        onPointerMove={e => {
          const g = grab.current
          if (!g) return
          place({ ...g.from, right: g.from.right - (e.clientX - g.x), bottom: g.from.bottom - (e.clientY - g.y) })
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {floating && (
          <button className={`btn btn-quiet btn-icon ${s.grip}`} data-grip aria-label="Mover el visor"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" onKeyDown={onMoveKey}><GripIcon /></button>
        )}
        <h2>Visor</h2>
        <button className="btn btn-quiet btn-icon" aria-pressed={floating}
          aria-label={floating ? 'Acoplar el visor' : 'Hacer flotar el visor'}
          data-cmd={floating ? 'Acoplar el visor' : 'Hacer flotar el visor'}
          onClick={() => onMode(floating ? 'open' : 'float')}><MinimizeIcon /></button>
        <button className="btn btn-quiet btn-icon" aria-pressed={mode === 'max'}
          aria-label={mode === 'max' ? 'Restaurar el visor' : 'Maximizar el visor'}
          data-cmd={mode === 'max' ? 'Restaurar el visor' : 'Maximizar el visor'}
          onClick={() => onMode(mode === 'max' ? 'open' : 'max')}>{mode === 'max' ? <RestoreIcon /> : <MaximizeIcon />}</button>
        {/* The table's toolbar carries the same switch for the palette, and the way back. */}
        <button className="btn btn-quiet btn-icon" aria-label="Plegar el visor" onClick={() => onMode('folded')}><PanelRightIcon /></button>
      </div>
      <div ref={onScreen} className={s.viewerScreen} />
      {floating && (
        <div
          className={s.corner}
          role="separator"
          aria-orientation="vertical"
          aria-label="Tamaño del visor"
          aria-valuemin={MIN_W}
          aria-valuenow={spot?.width}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          tabIndex={0}
          onPointerDown={e => { if (e.button === 0) start(e) }}
          onPointerMove={e => {
            const g = grab.current
            if (!g) return
            // Up and to the left, it grows; the opposite corner stays put.
            place({ ...g.from, width: g.from.width - (e.clientX - g.x + (e.clientY - g.y) * 16 / 9) / 2 })
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={onSizeKey}
        />
      )}
    </aside>
  )
}
