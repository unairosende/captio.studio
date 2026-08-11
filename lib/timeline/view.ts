/**
 * Which slice of the recording is on screen.
 *
 * The canvas stays the width of the viewport and the visible time window
 * changes, rather than the canvas growing with the zoom. Growing it is the
 * obvious approach and it does not survive contact with the job: setting a cue
 * boundary to a frame means roughly 125 pixels per second, which over a
 * feature-length track is a canvas hundreds of thousands of pixels wide.
 *
 * Scroll position is the input because a real scrollbar is worth having — it
 * shows how much track there is and where you are in it, for free.
 */

export interface VisibleWindow {
  /** Seconds at the left edge. */
  start: number
  /** Seconds across the viewport. */
  span: number
}

/** Beyond this, a viewport is a few milliseconds and scrolling becomes hopeless. */
export const MAX_ZOOM = 400

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(1, zoom))
}

export function visibleWindow(
  duration: number,
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): VisibleWindow {
  if (!(duration > 0) || !(scrollWidth > 0) || !(clientWidth > 0)) {
    return { start: 0, span: Math.max(0.1, duration) }
  }

  const span = duration * Math.min(1, clientWidth / scrollWidth)
  // Clamped against the last full screen rather than the whole track, so
  // scrolling to the end shows the end instead of running past it into blank
  // space — the thing that makes a timeline feel like it lost the audio.
  const start = Math.max(0, Math.min(duration - span, (scrollLeft / scrollWidth) * duration))

  return { start, span: Math.max(0.05, span) }
}

/**
 * Where to scroll so a moment is on screen.
 *
 * Returns null when it already is, so a playhead comfortably in view does not
 * fight somebody who has just scrolled elsewhere to look at something.
 */
export function scrollToShow(
  time: number,
  view: VisibleWindow,
  duration: number,
  scrollWidth: number,
): number | null {
  const margin = view.span * 0.1
  if (time >= view.start + margin && time <= view.start + view.span - margin) return null

  // Centred, because a playhead pinned to an edge gives no sense of what is
  // coming — and what is coming is the next line to be timed.
  const wanted = Math.max(0, Math.min(duration - view.span, time - view.span / 2))
  return (wanted / Math.max(0.1, duration)) * scrollWidth
}
