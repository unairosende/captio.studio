import { secToSrt, srtToSec } from '../subtitles/timecode.ts'
import { DEFAULT_FPS, type Subtitle } from '../subtitles/types.ts'

/**
 * Grabbing a cue on the timeline and moving its edges.
 *
 * The mouse part is easy. What is not is deciding what a drag is allowed to
 * produce, and the answer is not "whatever the pointer says": a cue dragged
 * past its own end inverts, and one dragged over its neighbour produces
 * overlapping subtitles, which players either stack on top of each other or
 * drop outright.
 *
 * So overlap is a hard limit here, while a cue being too *short* is not. Length
 * already has a quality warning, and a tool that refuses to let somebody make a
 * brief cue is fighting them over something the checks would point out anyway.
 * Malformed is prevented; merely questionable is reported.
 */

export type Edge = 'start' | 'end' | 'body'

export interface Grab {
  index: number
  edge: Edge
}

/** How close to an edge counts as grabbing it. */
const HANDLE_PX = 6

export interface HitArea {
  /** Top of the cue band, in canvas pixels. */
  top: number
  height: number
}

/**
 * Which cue is under the pointer, and which part of it.
 *
 * Searched from the end so that where cues touch, the one drawn last wins —
 * which is the one the person can actually see.
 */
export function hitTest(
  cues: Subtitle[],
  x: number,
  y: number,
  width: number,
  view: { start: number; span: number },
  band: HitArea,
): Grab | null {
  if (y < band.top || y > band.top + band.height) return null

  const toPx = (t: number) => ((t - view.start) / view.span) * width

  for (let i = cues.length - 1; i >= 0; i--) {
    const x0 = toPx(srtToSec(cues[i].start))
    const x1 = toPx(srtToSec(cues[i].end))
    if (x1 < -HANDLE_PX || x0 > width + HANDLE_PX) continue

    // Edges first: on a short cue the handles cover the body entirely, and
    // resizing is the likelier intent than moving something two frames long.
    if (Math.abs(x - x0) <= HANDLE_PX) return { index: i, edge: 'start' }
    if (Math.abs(x - x1) <= HANDLE_PX) return { index: i, edge: 'end' }
    if (x > x0 && x < x1) return { index: i, edge: 'body' }
  }
  return null
}

/** What a cue's times become after a drag. */
export interface Retimed {
  start: string
  end: string
}

/**
 * Move one edge of a cue to `seconds`.
 *
 * Clamped between the neighbouring cues and its own opposite edge, then snapped
 * to a frame — editors deliver on frame boundaries, and a value in between
 * drifts when the file is re-imported into an NLE.
 */
export function moveEdge(
  cues: Subtitle[],
  index: number,
  edge: 'start' | 'end',
  seconds: number,
  options: { fps?: number; duration?: number } = {},
): Retimed | null {
  const cue = cues[index]
  if (!cue) return null

  const fps = options.fps ?? DEFAULT_FPS
  const frame = 1 / fps
  const start = srtToSec(cue.start)
  const end = srtToSec(cue.end)

  if (edge === 'start') {
    const floor = index > 0 ? srtToSec(cues[index - 1].end) : 0
    const ceiling = end - frame
    const at = Math.max(floor, Math.min(ceiling, seconds))
    return { start: secToSrt(at, fps), end: cue.end }
  }

  const floor = start + frame
  const ceiling =
    index < cues.length - 1
      ? srtToSec(cues[index + 1].start)
      : (options.duration ?? Number.POSITIVE_INFINITY)
  const at = Math.max(floor, Math.min(ceiling, seconds))
  return { start: cue.start, end: secToSrt(at, fps) }
}

/**
 * Slide a whole cue by `delta` seconds, keeping its length.
 *
 * Length is preserved even when a neighbour stops the move early. A cue that
 * quietly got shorter because it was dragged into the next one is a change
 * nobody asked for and nobody would notice until the export.
 */
export function moveWhole(
  cues: Subtitle[],
  index: number,
  delta: number,
  options: { fps?: number; duration?: number } = {},
): Retimed | null {
  const cue = cues[index]
  if (!cue) return null

  const fps = options.fps ?? DEFAULT_FPS
  const start = srtToSec(cue.start)
  const end = srtToSec(cue.end)
  const length = end - start

  const floor = index > 0 ? srtToSec(cues[index - 1].end) : 0
  const ceiling =
    index < cues.length - 1
      ? srtToSec(cues[index + 1].start)
      : (options.duration ?? Number.POSITIVE_INFINITY)

  // Room to move rather than room to exist: where the gap is smaller than the
  // cue, it stays put instead of being squeezed.
  const at = Math.max(floor, Math.min(ceiling - length, start + delta))

  return { start: secToSrt(at, fps), end: secToSrt(at + length, fps) }
}
