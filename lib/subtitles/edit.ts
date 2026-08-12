import { midTimecode, secToSrt, tcToMs } from './timecode.ts'
import type { Subtitle } from './types.ts'

/**
 * Structural edits: splitting a cue in two, and taking one out.
 *
 * Numbering is positional — cue 7 is the seventh cue — so both operations
 * renumber everything after the change. The caller applies the same operation
 * to every language, because a cue is one moment of the recording that happens
 * to have been written several times over; splitting only the tab on screen
 * would leave the languages with different cue counts and no way to line them
 * up again.
 */

const renumber = (subs: Subtitle[]): Subtitle[] => subs.map((s, i) => ({ ...s, index: i + 1 }))

/**
 * Where to cut cue `cue`.
 *
 * `atSec` is the playhead. It is ignored unless it lands strictly inside the
 * cue: a cut on or past a boundary makes a cue of zero length, which players
 * either drop or flash. Without a usable playhead the cut is the midpoint,
 * which is what splitting meant before there was a timeline.
 */
function cutPoint(cue: Subtitle, atSec: number | undefined, fps?: number): string {
  if (atSec !== undefined) {
    const tc = secToSrt(atSec, fps)
    const ms = tcToMs(tc)
    if (ms > tcToMs(cue.start) && ms < tcToMs(cue.end)) return tc
  }
  return midTimecode(cue.start, cue.end)
}

/**
 * Split cue `index` in two at `atSec`, or at its midpoint.
 *
 * The text is divided in the same proportion as the time, at a word boundary:
 * cutting three quarters of the way through leaves roughly three quarters of
 * the words above. It is a guess either way — nothing here knows which word was
 * spoken when — but a guess that follows the cut beats always halving. The
 * first half always keeps at least one word; a one-word cue therefore splits
 * into the word and an empty cue, which the quality checks flag, rather than
 * into the same word twice, which they would not.
 */
export function splitCue(
  subs: Subtitle[],
  index: number,
  atSec?: number,
  fps?: number,
): Subtitle[] {
  const pos = subs.findIndex(s => s.index === index)
  if (pos < 0) return subs

  const cue = subs[pos]
  const cut = cutPoint(cue, atSec, fps)

  const span = tcToMs(cue.end) - tcToMs(cue.start)
  const fraction = span > 0 ? (tcToMs(cut) - tcToMs(cue.start)) / span : 0.5

  const words = cue.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)
  const at = Math.min(Math.max(1, Math.round(words.length * fraction)), Math.max(1, words.length - 1))

  return renumber([
    ...subs.slice(0, pos),
    { ...cue, end: cut, text: words.slice(0, at).join(' ') },
    { ...cue, start: cut, text: words.slice(at).join(' ') },
    ...subs.slice(pos + 1),
  ])
}

/** Remove cue `index`. Unknown index leaves the list alone. */
export function deleteCue(subs: Subtitle[], index: number): Subtitle[] {
  const kept = subs.filter(s => s.index !== index)
  return kept.length === subs.length ? subs : renumber(kept)
}
