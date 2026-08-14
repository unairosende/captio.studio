/**
 * What somebody means when they type into the command palette.
 *
 * Two of the three things a subtitler wants from a search box on a
 * feature-length track are not searches at all: "take me to cue 412" and "take
 * me to 01:12:30". Both are typed, both are unambiguous, and neither is worth a
 * mode switch.
 *
 * `srtToSec` cannot stand in for the timecode half — it insists on the
 * milliseconds and answers 0 to `1:23`, which is what a person actually types.
 * Answering 0 would quietly send them to the start of the film.
 */

export type Goto =
  | { kind: 'cue'; index: number }
  | { kind: 'time'; seconds: number }

/**
 * A bare number is a cue; anything with a colon is a clock.
 *
 * The bare case has to pick one, and cue numbers are what is printed on the
 * cards somebody is looking at. `42` meaning forty-two seconds would be a fair
 * guess in a different tool; here it is the wrong one nine times out of ten.
 */
export function parseGoto(input: string): Goto | null {
  const s = input.trim()
  if (!s) return null

  const cue = s.match(/^#?(\d{1,6})$/)
  if (cue) {
    const index = Number(cue[1])
    return index > 0 ? { kind: 'cue', index } : null
  }

  // [HH:]MM:SS[,mmm | .mmm]
  const time = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/)
  if (!time) return null

  const [, hh, mm, ss, frac] = time
  if (Number(mm) > 59 || Number(ss) > 59) return null

  // A single digit after the comma is tenths, not milliseconds — the reading a
  // stopwatch gives, and the only one that makes a typed fraction usable.
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0

  return {
    kind: 'time',
    seconds: Number(hh ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + ms / 1000,
  }
}
