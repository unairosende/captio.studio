/**
 * Where the playhead is, for the parts of the editor that are not the timeline.
 *
 * The timeline keeps it in a ref and moves it every animation frame; putting it
 * in the store instead would re-render the whole editor sixty times a second to
 * move a one-pixel line. So the timeline lends out a way to read it, and
 * callers ask only at the moment they need an answer — which, for splitting a
 * cue, is once, on a click.
 *
 * Null means no timeline is mounted. Callers fall back to whatever they did
 * before there was one.
 */
let read: (() => number) | null = null

export function publishPlayhead(fn: (() => number) | null): void {
  read = fn
}

export function playheadSeconds(): number | null {
  return read?.() ?? null
}

/**
 * Moving it, lent out the same way.
 *
 * The command palette needs this: typing a timecode and landing there is the
 * one thing a menu cannot do for somebody working through a feature-length
 * track. Same shape as the read above, and for the same reason — the position
 * lives in a ref inside the timeline, and hoisting it into the store so that one
 * text box could move it would cost a re-render of the editor on every frame of
 * playback.
 */
let jump: ((seconds: number) => void) | null = null

export function publishSeek(fn: ((seconds: number) => void) | null): void {
  jump = fn
}

/** Returns whether anything was listening, so a caller can say "no timeline". */
export function seekTo(seconds: number): boolean {
  if (!jump) return false
  jump(seconds)
  return true
}
