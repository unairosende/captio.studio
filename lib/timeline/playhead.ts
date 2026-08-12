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
