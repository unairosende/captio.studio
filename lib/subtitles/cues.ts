import { reflowText } from './layout.ts'
import { secToSrt } from './timecode.ts'
import { DEFAULT_QC, type QcConfig, type Subtitle } from './types.ts'

/**
 * Cues built from word timings.
 *
 * Whisper hands back segments it chose itself, and it chose them for
 * transcription rather than for subtitling: frequently one long paragraph
 * spanning a whole answer, which then has to be split by hand. A recogniser
 * that returns per-word timings lets the boundaries be decided here, by the
 * same rules the quality checks already enforce — so the output starts inside
 * the limits instead of being dragged into them afterwards.
 *
 * The boundary rules, in the order they matter:
 *
 *  1. A change of speaker always breaks. Two people never share a cue, and
 *     that is the whole reason for asking the recogniser to diarise.
 *  2. A silence long enough to hear breaks, because that is where a viewer
 *     expects the text to change.
 *  3. A finished sentence breaks, once there is enough on screen to be worth a
 *     cue of its own.
 *  4. Length and duration are hard ceilings, applied last.
 */

export interface TimedWord {
  text: string
  /** Seconds from the start of the recording. */
  start: number
  end: number
  /** Whatever the recogniser calls this voice. Compared, never displayed. */
  speakerId?: string | null
}

/** A pause a viewer would notice. Anything shorter is just speech rhythm. */
const PAUSE_SECONDS = 0.8

/**
 * Below this, a finished sentence is not worth a cue of its own — "Yes." would
 * flash and vanish. It waits and shares a cue with what follows.
 */
const MIN_SENTENCE_CHARS = 24

/** Sentence enders, allowing a closing quote or bracket after them. */
const SENTENCE_END = /[.!?…]["'»”’)\]]?$/

export function cuesFromWords(
  words: TimedWord[],
  cfg: QcConfig = DEFAULT_QC,
  fps?: number,
): Subtitle[] {
  const usable = words.filter(w => w.text.trim().length > 0)
  if (usable.length === 0) return []

  // Two lines is what a viewer can read. The config may allow more for
  // vertical formats, so the budget follows it rather than assuming.
  const budget = cfg.maxChars * Math.min(2, cfg.maxLines)

  const groups: TimedWord[][] = []
  let current: TimedWord[] = []
  let length = 0

  for (const word of usable) {
    const previous = current[current.length - 1]
    const text = word.text.trim()

    // Guarded on `current.length` so a single word longer than the budget
    // still lands somewhere: opening a fresh group for it would never end.
    const wouldOverflow = current.length > 0 && length + 1 + text.length > budget
    const speakerChanged =
      previous != null && (word.speakerId ?? null) !== (previous.speakerId ?? null)
    const longPause = previous != null && word.start - previous.end >= PAUSE_SECONDS
    const tooLong = previous != null && word.end - current[0].start > cfg.maxDur
    const afterSentence =
      previous != null && SENTENCE_END.test(previous.text.trim()) && length >= MIN_SENTENCE_CHARS

    if (speakerChanged || longPause || afterSentence || wouldOverflow || tooLong) {
      groups.push(current)
      current = []
      length = 0
    }

    current.push({ ...word, text })
    length += (length === 0 ? 0 : 1) + text.length
  }
  if (current.length > 0) groups.push(current)

  const cues = groups.map((group, i) => ({
    index: i + 1,
    start: secToSrt(group[0].start, fps),
    end: secToSrt(group[group.length - 1].end, fps),
    // Joined with spaces, which is right for the languages this is sold into
    // and wrong for Chinese and Japanese, where words are not separated. If
    // those are ever supported, keep the recogniser's own spacing tokens
    // rather than reconstructing the gaps here.
    text: reflowText(group.map(w => w.text).join(' '), cfg.maxChars),
  }))

  return holdShortCues(cues, cfg, fps)
}

/**
 * Give a cue that would flash past a little longer on screen.
 *
 * Never at the expense of the next one: pushing an end past the following start
 * produces overlapping cues, which players either stack or drop. A cue with no
 * room to grow stays short, and the quality checks will say so.
 */
function holdShortCues(cues: Subtitle[], cfg: QcConfig, fps?: number): Subtitle[] {
  return cues.map((cue, i) => {
    const startSec = toSeconds(cue.start)
    const endSec = toSeconds(cue.end)
    if (endSec - startSec >= cfg.minDur) return cue

    const nextStart = cues[i + 1] ? toSeconds(cues[i + 1].start) : Infinity
    const wanted = Math.min(startSec + cfg.minDur, nextStart)
    return wanted > endSec ? { ...cue, end: secToSrt(wanted, fps) } : cue
  })
}

/** Local rather than imported: srtToSec tolerates junk this never produces. */
function toSeconds(srt: string): number {
  const [h, m, rest] = srt.split(':')
  const [s, ms] = rest.split(',')
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}
