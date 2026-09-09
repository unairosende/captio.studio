import type { QcConfig, QcIssue, Severity, Subtitle } from './types.ts'
import { DEFAULT_QC } from './types.ts'
import { tcToMs } from './timecode.ts'

export function cueSeconds(sub: Subtitle): number {
  return (tcToMs(sub.end) - tcToMs(sub.start)) / 1000
}

/** Characters per second. `null` when the cue has no positive duration. */
export function cueCps(sub: Subtitle): number | null {
  const dur = cueSeconds(sub)
  if (dur <= 0) return null
  return (sub.text || '').replace(/\n/g, ' ').length / dur
}

/**
 * Text-only check, used for the live character bar while typing.
 *
 * Two lines is a hard ceiling regardless of configuration: it is a style-guide
 * rule across broadcast, not a preference.
 */
export function charStatus(text: string, cfg: QcConfig = DEFAULT_QC): Severity {
  const lines = (text || '').split('\n')
  const longest = Math.max(0, ...lines.map(l => l.length))
  const maxLines = Math.min(2, cfg.maxLines)
  if (longest > cfg.maxChars || lines.length > maxLines) return 'error'
  if (longest > Math.floor(cfg.maxChars * 0.85)) return 'warn'
  return 'ok'
}

/**
 * The smallest repeat worth reporting.
 *
 * Two words is ordinary: Spanish runs on short function words, and "de la" or
 * "que no" landing on both sides of a cue boundary is chance rather than a
 * mistake. Three in a row, opening the next cue, is the signature of a subtitle
 * that was divided by copying instead of by cutting.
 */
const MIN_REPEATED_WORDS = 3

/**
 * Words, lowercased and stripped of punctuation.
 *
 * Apostrophes stay inside the word so "don't" and "l'eau" count as one each;
 * every other mark goes, because the same phrase either side of a split is
 * routinely punctuated differently — a comma on one line, nothing on the other.
 */
const words = (text: string): string[] =>
  (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’]+/gu, ' ')
    .split(' ')
    .filter(Boolean)

/**
 * How many words `next` opens with that already appear inside `prev`.
 *
 * Splitting a long subtitle in two should move the tail down, not copy it, but
 * a model asked to divide one often writes the overlap into both halves. Each
 * line then reads correctly on its own, which is why this survives proofreading
 * and only shows up on screen, where the same phrase is said twice.
 *
 * Anchored at the start of `next` and searched anywhere in `prev`, rather than
 * comparing the two ends. The copy always lands at the head of the second cue,
 * but it is not always the tail of the first: where the duplicated run is
 * followed by more duplicated text that was then edited — one cue saying "De
 * Ruar" where the next says "Terroir" — an end-to-end comparison sees a
 * mismatch and reports nothing. The anchor is what keeps the wider search
 * quiet: ordinary dialogue repeats itself often, but rarely by beginning a cue
 * with three words said verbatim in the one before.
 *
 * Longest match first, so the message names the whole repeat rather than part
 * of it. The nested scan is bounded by the character limit — a cue is a couple
 * of dozen words, not a paragraph.
 */
export function repeatedWords(prev: string, next: string): number {
  const a = words(prev)
  const b = words(next)

  for (let k = Math.min(a.length, b.length); k >= MIN_REPEATED_WORDS; k--) {
    const head = b.slice(0, k)
    for (let i = 0; i + k <= a.length; i++) {
      if (head.every((w, j) => w === a[i + j])) return k
    }
  }
  return 0
}

/**
 * A glossary term, ready to be looked for.
 *
 * Compiled once per track rather than once per cue. A feature-length job is a
 * thousand cues and a glossary is a few dozen terms, so building the patterns
 * inside the per-cue check would construct tens of thousands of identical
 * regular expressions to read the same list every time.
 */
export interface GlossaryPattern {
  /** Exactly how the term must appear. */
  expected: string
  re: RegExp
}

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Prepare the glossary for checking.
 *
 * The word boundaries are lookarounds over Unicode letters rather than `\b`,
 * which is defined on ASCII: `\bÑoño\b` does not match, because JavaScript
 * does not consider "Ñ" a word character and so finds no boundary in front of
 * it. A glossary of Spanish brand names is exactly where that shows up.
 */
export function compileGlossary(
  entries: readonly { term?: string; translation?: string }[] = [],
): GlossaryPattern[] {
  const out: GlossaryPattern[] = []
  for (const entry of entries) {
    // An entry with no translation means "leave this exactly as written", so
    // the term is its own expected form.
    const expected = (entry?.translation?.trim() || entry?.term?.trim()) ?? ''
    if (!expected) continue
    out.push({
      expected,
      re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(expected)}(?![\\p{L}\\p{N}])`, 'giu'),
    })
  }
  return out
}

/**
 * Nothing but sentence-opening punctuation stands before this position.
 *
 * Needed for the one case where a term that does not match the glossary is
 * still correct: a term whose agreed form is lower case — "terroir" is a
 * common noun in English — is capitalised when it opens a sentence. That is
 * grammar, not a translator ignoring the glossary.
 */
function atSentenceStart(text: string, at: number): boolean {
  return /(?:^|[.!?…:\n])["'«»¿¡\s\-—–]*$/.test(text.slice(0, at))
}

/**
 * Check the cue against the terms the translation promised to use.
 *
 * The glossary is the product's answer to "will the client's vocabulary come
 * out the same in cue 4 and in cue 900". The model is told about it on every
 * request and nothing has ever checked the reply — so a term it quietly
 * ignored, or spelled two ways, shipped looking like finished work.
 *
 * Case only. A term the model translated into something else entirely is a
 * different failure, and finding it means guessing which words were meant to
 * be the term — this reports what it can prove: the words are here, and they
 * are not written the way they were promised.
 */
export function glossaryIssues(text: string, terms: readonly GlossaryPattern[]): QcIssue[] {
  const issues: QcIssue[] = []
  const seen = new Set<string>()

  // Line breaks are collapsed first, because layout puts them inside terms.
  // "Reserva de la Familia" is twenty-one characters and does not fit a
  // forty-two character line beside anything else, so reflow wraps it in the
  // middle — and a term matched against the raw text then contains a newline
  // where the glossary has a space. It matches nothing, whether it was written
  // correctly or not, which makes this check quietly useless on exactly the
  // long multi-word names it exists for.
  const flat = (text || '').replace(/\s+/g, ' ')

  for (const { expected, re } of terms) {
    for (const match of flat.matchAll(re)) {
      const found = match[0]
      if (found === expected) continue

      // Differs in the first letter only, and opens a sentence: correct.
      const onlyFirstLetter =
        found.slice(1) === expected.slice(1) &&
        found[0]?.toLowerCase() === expected[0]?.toLowerCase()
      if (onlyFirstLetter && atSentenceStart(flat, match.index)) continue

      const msg = `Glossary term written as "${found}" — should be "${expected}"`
      if (seen.has(msg)) continue
      seen.add(msg)
      issues.push({ level: 'warn', msg })
    }
  }

  return issues
}

/**
 * Full quality check for one cue.
 *
 * `prev` is the preceding cue, needed for gap and overlap checks. Timings live
 * on the source cues and every translation mirrors them, so callers should look
 * `prev` up in the source track, not in the translated one.
 */
export function qcIssues(
  sub: Subtitle,
  prev?: Subtitle | null,
  cfg: QcConfig = DEFAULT_QC,
  /** Compiled by `compileGlossary`, once per track. Empty skips the check. */
  terms: readonly GlossaryPattern[] = [],
): QcIssue[] {
  const issues: QcIssue[] = []
  const lines = (sub.text || '').split('\n')
  const longest = Math.max(0, ...lines.map(l => l.length))
  const maxLines = Math.min(2, cfg.maxLines)

  if (longest > cfg.maxChars) {
    issues.push({ level: 'error', msg: `Line too long — ${longest}/${cfg.maxChars} chars` })
  } else if (longest > Math.floor(cfg.maxChars * 0.85)) {
    issues.push({ level: 'warn', msg: `Line near limit — ${longest}/${cfg.maxChars} chars` })
  }
  if (lines.length > maxLines) {
    issues.push({ level: 'error', msg: `${lines.length} lines (max ${maxLines})` })
  }

  const dur = cueSeconds(sub)
  if (dur <= 0) {
    issues.push({ level: 'error', msg: 'End time is not after start time' })
  } else {
    const cps = cueCps(sub)!
    if (cps > cfg.cpsError) {
      issues.push({ level: 'error', msg: `Reading speed ${cps.toFixed(1)} cps (max ${cfg.cpsError})` })
    } else if (cps > cfg.cpsWarn) {
      issues.push({ level: 'warn', msg: `Reading speed ${cps.toFixed(1)} cps (over ${cfg.cpsWarn})` })
    }
    if (dur < cfg.minDur) {
      issues.push({ level: 'warn', msg: `Too short — ${dur.toFixed(2)}s (min ${cfg.minDur}s)` })
    }
    if (dur > cfg.maxDur) {
      issues.push({ level: 'warn', msg: `Too long — ${dur.toFixed(1)}s (max ${cfg.maxDur}s)` })
    }
  }

  if (prev) {
    const gap = (tcToMs(sub.start) - tcToMs(prev.end)) / 1000
    if (gap < 0) {
      issues.push({ level: 'error', msg: `Overlaps cue #${prev.index} by ${Math.abs(gap).toFixed(2)}s` })
    } else if (gap < cfg.minGap) {
      issues.push({ level: 'warn', msg: `Gap ${gap.toFixed(2)}s after cue #${prev.index} (min ${cfg.minGap}s)` })
    }

    // A warning, never an error: everything above this line is a measurement
    // and this one is a guess about content. A cue can legitimately repeat the
    // one before it — a chorus, somebody stammering — and a check that blocked
    // the work over that would be worse than one that is sometimes dismissed.
    const repeated = repeatedWords(prev.text, sub.text)
    if (repeated) {
      issues.push({
        level: 'warn',
        msg: `Opens with ${repeated} words already in cue #${prev.index}`,
      })
    }
  }

  issues.push(...glossaryIssues(sub.text, terms))

  return issues
}

export function qcStatus(
  sub: Subtitle,
  prev?: Subtitle | null,
  cfg: QcConfig = DEFAULT_QC,
  terms: readonly GlossaryPattern[] = [],
): Severity {
  const issues = qcIssues(sub, prev, cfg, terms)
  if (issues.some(i => i.level === 'error')) return 'error'
  return issues.length ? 'warn' : 'ok'
}

/**
 * Check a whole track in one pass, pairing each cue with its predecessor.
 *
 * Preferred over calling `qcStatus` per card: it is one traversal instead of a
 * lookup per cue, which matters on feature-length tracks.
 */
export function qcTrack(
  subs: Subtitle[],
  cfg: QcConfig = DEFAULT_QC,
  /**
   * The terms this track promised to use, if it is a translation.
   *
   * Left out for the source: a glossary governs what the translation must say,
   * and holding the client's own file to it would report their spelling back
   * to them as a fault.
   */
  glossary: readonly { term?: string; translation?: string }[] = [],
): Map<number, { status: Severity; issues: QcIssue[] }> {
  const out = new Map<number, { status: Severity; issues: QcIssue[] }>()
  // Once for the track, not once per cue.
  const terms = compileGlossary(glossary)
  subs.forEach((sub, i) => {
    const issues = qcIssues(sub, i > 0 ? subs[i - 1] : null, cfg, terms)
    const status: Severity = issues.some(x => x.level === 'error')
      ? 'error'
      : issues.length
        ? 'warn'
        : 'ok'
    out.set(sub.index, { status, issues })
  })
  return out
}
