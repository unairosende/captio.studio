import type { QcConfig, Subtitle } from './types.ts'
import { DEFAULT_QC } from './types.ts'
import { midTimecode } from './timecode.ts'

/**
 * Line breaking and vertical layout.
 *
 * Where to break a subtitle is craft, not arithmetic: a reader takes in a cue
 * as a shape, and a break that lands mid-clause costs them a beat. The rules
 * below are the ones subtitling style guides agree on.
 */

/** A break reads better after these — the clause has already closed. */
const PUNCT_AFTER_WORD = /[,;:!?\-—]$/

/**
 * ...and before these, which open a new clause.
 *
 * English and Spanish only. A French or German customer gets the length-balanced
 * fallback, which is correct but not idiomatic — extending this list is the
 * cheapest way to make a new language feel native.
 */
const NATURAL_BREAK_BEFORE =
  /^(and|but|or|so|yet|nor|for|because|although|while|when|where|which|that|who|however|therefore|thus|then|after|before|since|though|if|as|once|until|unless|whether|whereas|y|e|o|u|ni|pero|sino|porque|pues|aunque|mientras|cuando|donde|que|quien|quienes|si|como|para|ya|entonces|después|antes|desde|hasta|además)$/i

/**
 * Reflow text onto at most two lines of `limit` characters.
 *
 * Two passes. The first only considers breaks that leave the top line no longer
 * than the bottom one — the convention, because a short line over a long one
 * reads as a lead-in rather than a leftover — and rewards breaking after
 * punctuation or before a conjunction. The second pass drops that preference
 * and simply balances, for text where no such break exists.
 *
 * TWO LINES IS A CEILING, NOT A GUARANTEE OF FIT. Text that cannot fit two
 * lines of `limit` comes back with a line still over it, because the answer in
 * that case is not a third line — it is a second cue, and only the caller knows
 * whether the timing allows one. `qcIssues` flags the overflow so it cannot
 * pass unnoticed.
 *
 * A single word longer than `limit` is returned whole. Hyphenating mid-word is
 * wrong in subtitles, so the human decides what to do with it.
 */
export function reflowText(text: string, limit: number): string {
  const flat = text.replace(/\r?\n|\r/g, ' ').replace(/ {2,}/g, ' ').trim()
  if (flat.length <= limit) return flat

  const words = flat.split(' ')
  if (words.length < 2) return flat

  let bestSplit = -1
  let bestScore = -Infinity

  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ')
    const l2 = words.slice(i).join(' ')
    if (l1.length > limit || l2.length > limit) continue
    if (l1.length > l2.length) continue

    let score = -(l2.length - l1.length)
    if (PUNCT_AFTER_WORD.test(words[i - 1])) score += 12
    if (NATURAL_BREAK_BEFORE.test(words[i])) score += 8
    if (score > bestScore) {
      bestScore = score
      bestSplit = i
    }
  }

  if (bestSplit === -1) {
    let closest = Infinity
    for (let i = 1; i < words.length; i++) {
      const l1 = words.slice(0, i).join(' ')
      const l2 = words.slice(i).join(' ')
      if (l1.length > limit || l2.length > limit) continue
      const score = Math.abs(l1.length - l2.length)
      if (score < closest) {
        closest = score
        bestSplit = i
      }
    }
  }

  if (bestSplit > 0) {
    return words.slice(0, bestSplit).join(' ') + '\n' + words.slice(bestSplit).join(' ')
  }

  // A single word longer than the limit: break it rather than overflow.
  const cut = flat.lastIndexOf(' ', limit)
  if (cut > 0) return flat.slice(0, cut) + '\n' + flat.slice(cut + 1)
  return flat.slice(0, limit) + '\n' + flat.slice(limit)
}

export type OutputMode = 'horizontal' | 'vertical'

/** Characters that fit on a line, by delivery format. */
export const MAX_CHARS_HORIZONTAL = 42
export const MAX_CHARS_VERTICAL = 32

/**
 * Quality thresholds for a given output mode.
 *
 * Vertical delivery is narrower, so the same cue is fine in one and too long in
 * the other. Everything downstream — the character bar, the QC pills, the
 * reflow limit — has to agree on which number applies, so they all come from
 * here rather than each picking their own constant.
 */
export function qcForMode(mode: OutputMode, base: QcConfig = DEFAULT_QC): QcConfig {
  return {
    ...base,
    maxChars: mode === 'vertical' ? MAX_CHARS_VERTICAL : MAX_CHARS_HORIZONTAL,
  }
}

/**
 * Split cues that will not fit the narrower vertical layout.
 *
 * Vertical video leaves far less width, so a cue that was fine at 42 characters
 * has to become two. The split lands at the midpoint of the cue's duration —
 * crude, but it keeps both halves on screen for the words they carry, and
 * anything smarter needs the audio.
 */
export function splitForVertical(subs: Subtitle[], cfg: QcConfig = DEFAULT_QC): Subtitle[] {
  const result: Subtitle[] = []
  let idx = 1

  for (const sub of subs) {
    const lines = sub.text.split('\n')
    if (!lines.some(l => l.length > cfg.maxChars) && lines.length <= cfg.maxLines) {
      result.push({ ...sub, index: idx++ })
      continue
    }

    const all = lines.join(' ').trim()
    let split = all.lastIndexOf(' ', Math.ceil(all.length / 2))
    if (split < 1) split = Math.ceil(all.length / 2)

    const mid = midTimecode(sub.start, sub.end)
    result.push({ index: idx++, start: sub.start, end: mid, text: all.slice(0, split).trim() })
    result.push({ index: idx++, start: mid, end: sub.end, text: all.slice(split).trim() })
  }

  return result
}

/** What the viewer actually gets, once the output mode is applied. */
export function finalSubs(
  subs: Subtitle[],
  mode: OutputMode,
  cfg: QcConfig = DEFAULT_QC,
): Subtitle[] {
  return mode === 'vertical' ? splitForVertical(subs, cfg) : subs
}
