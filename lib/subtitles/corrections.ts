import { wordDiff } from './diff.ts'
import type { Subtitle } from './types.ts'

/**
 * What the team corrects, read from what the machine wrote and what was kept.
 *
 * Two things are learnt from it, both by comparing `machine` with `text` on
 * each cue. In a transcription, the same misspelling corrected by hand again
 * and again becomes a suggested glossary variant, so the next file is spelt
 * right on arrival. In a translation, every corrected line is remembered
 * against the line it translates, so the same line is never corrected twice.
 */

/** Words either side of a substitution may span. Past this it is a rewrite, not a spelling. */
const MAX_RUN_WORDS = 5

/** Punctuation travels with the words in a diff; a misspelling is the letters. */
const trimPunct = (s: string): string => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

/** Case and spacing are not what makes two spellings different. */
const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

export interface Substitution {
  /** What the machine wrote. */
  from: string
  /** What a person put in its place. */
  to: string
}

/**
 * What a person put in place of what the machine wrote, one run at a time.
 *
 * Read off a word diff: between two stretches the texts agree on, the words
 * taken out and the words put in are one substitution. A run that only removes
 * or only adds is a cut or an addition, not a spelling. Neither is a run whose
 * sides differ by more than a word — "Cap tío" for "Captio" is a misspelling,
 * three words for one is a rewrite. Capitalisation alone never counts: the
 * diff compares words case-blind, because a recogniser capitalising by
 * position is not a mistake anybody needs taught.
 */
export function substitutions(machine: string, text: string): Substitution[] {
  const out: Substitution[] = []
  let del: string[] = []
  let ins: string[] = []

  const flush = () => {
    const from = trimPunct(del.join(' '))
    const to = trimPunct(ins.join(' '))
    const plausible =
      del.length <= MAX_RUN_WORDS && ins.length <= MAX_RUN_WORDS && Math.abs(del.length - ins.length) <= 1
    if (from && to && plausible && fold(from) !== fold(to)) out.push({ from, to })
    del = []
    ins = []
  }

  // Per word, so "Captio," and "Captio" are the same word followed by a comma
  // somebody added, not a word that was replaced.
  const words = (s: string) => s.split(/\s+/).map(trimPunct).filter(Boolean).join(' ')

  for (const op of wordDiff(words(machine), words(text))) {
    if (op.type === 'eq') flush()
    else if (op.type === 'del') del.push(op.val)
    else ins.push(op.val)
  }
  flush()
  return out
}

export interface VariantSuggestion {
  /** How the team writes it. */
  term: string
  /** What the transcription wrote instead. */
  variant: string
  /** How many times somebody corrected it by hand. */
  count: number
}

/** What a dismissed suggestion is remembered by. */
export const suggestionKey = (s: { term: string; variant: string }): string => `${fold(s.variant)}→${s.term}`

/**
 * Hand corrections to a transcription, made often enough to be worth a rule.
 *
 * Twice by default: once is a slip, twice is a habit of the recogniser. Nothing
 * already in the glossary is suggested again — neither a variant it lists nor a
 * term it governs, which a person changing would be a judgement about context,
 * not a misspelling. Where the same misspelling was corrected two ways, the
 * more frequent correction is the one offered.
 *
 * Suggested, never applied: a variant rewrites every future transcription, and
 * "haber" corrected to "a ver" twice is right twice and wrong everywhere else.
 */
export function suggestVariants(
  cues: readonly Pick<Subtitle, 'text' | 'machine'>[],
  glossary: readonly { term?: string; variants?: string[] }[] = [],
  dismissed: readonly string[] = [],
  minCount = 2,
): VariantSuggestion[] {
  const known = new Set(
    glossary.flatMap(e => [e?.term ?? '', ...(e?.variants ?? [])]).map(fold).filter(Boolean),
  )
  const ignored = new Set(dismissed)
  const counted = new Map<string, VariantSuggestion>()

  for (const cue of cues) {
    if (!cue?.machine || cue.machine === cue.text) continue
    for (const { from, to } of substitutions(cue.machine, cue.text)) {
      if (known.has(fold(from))) continue
      const key = suggestionKey({ term: to, variant: from })
      if (ignored.has(key)) continue
      const seen = counted.get(key) ?? { term: to, variant: from, count: 0 }
      seen.count++
      counted.set(key, seen)
    }
  }

  const best = new Map<string, VariantSuggestion>()
  for (const s of counted.values()) {
    const prev = best.get(fold(s.variant))
    if (!prev || s.count > prev.count) best.set(fold(s.variant), s)
  }
  return [...best.values()]
    .filter(s => s.count >= minCount)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
}

/** How a source line is looked up: by its words, not their case, spacing or line breaks. */
export const memoryKey = (text: string): string => fold(text)

/**
 * The translations somebody corrected, keyed by the line they translate.
 *
 * Only corrected ones. A line nobody touched is what the model would write
 * again anyway; a line somebody changed is a decision, and the point of
 * remembering is not to have to make it twice. Tracks are read in order and a
 * later one overwrites an earlier, so pass them oldest first.
 */
export function correctedTranslations(
  tracks: readonly { subtitles: readonly Subtitle[]; translation?: readonly Subtitle[] }[],
): Record<string, string> {
  const out = new Map<string, string>()
  for (const { subtitles, translation = [] } of tracks) {
    const source = new Map(subtitles.map(s => [s.index, s.text]))
    for (const cue of translation) {
      const text = cue?.text?.trim()
      if (!text || cue.machine === undefined || cue.machine.trim() === text) continue
      const line = source.get(cue.index)
      if (line?.trim()) out.set(memoryKey(line), cue.text)
    }
  }
  // fromEntries, not assignment: a line reading "__proto__" is still just a line.
  return Object.fromEntries(out)
}

/** The remembered translation of a line, if there is one. */
export function recall(memory: Readonly<Record<string, string>>, line: string): string | undefined {
  const key = memoryKey(line)
  return key && Object.hasOwn(memory, key) ? memory[key] : undefined
}
