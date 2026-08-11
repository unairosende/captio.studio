/**
 * The scale along the top of the timeline.
 *
 * Ticks have to land on numbers a person reads without decoding: 5, 15, 30
 * seconds, a minute. Dividing the width by a round number of pixels gives
 * intervals like 3.7s, legible only to the machine that produced them.
 */

/** Intervals a viewer reads instantly, coarsest last. */
const NICE_INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600]

const COARSEST = NICE_INTERVALS[NICE_INTERVALS.length - 1]

/**
 * Seconds between ticks, given how many will fit.
 *
 * Picks the finest interval that does not produce more ticks than asked for, so
 * zooming in reveals detail instead of crowding the same labels together.
 */
export function tickEvery(duration: number, maxTicks: number): number {
  if (!(duration > 0) || !(maxTicks > 0)) return COARSEST

  for (const interval of NICE_INTERVALS) {
    if (duration / interval <= maxTicks) return interval
  }
  // Longer than every interval can cover at this width. The coarsest is still
  // right; the labels simply thin out, which is what a very long file wants.
  return COARSEST
}

/**
 * A tick label: `mm:ss`, or `h:mm:ss` once there is an hour to show.
 *
 * Deliberately not the SRT format used elsewhere. A ruler crowded with
 * `00:04:31,000` is unreadable, and the milliseconds are noise at any zoom a
 * ruler is drawn at.
 */
export function rulerLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0')
  const ss = String(whole % 60).padStart(2, '0')

  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The playhead readout, where the milliseconds are the whole point. */
export function clockLabel(seconds: number): string {
  const safe = Math.max(0, seconds)
  const hh = String(Math.floor(safe / 3600)).padStart(2, '0')
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, '0')
  const ss = String(Math.floor(safe % 60)).padStart(2, '0')
  const ms = String(Math.round((safe % 1) * 1000)).padStart(3, '0')

  return `${hh}:${mm}:${ss},${ms}`
}
