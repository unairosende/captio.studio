import { escapeRe } from './qc.ts'

/** The two fields of a glossary entry the transcription cares about. */
interface Spelling {
  term?: string
  variants?: string[]
}

/** How a spelling is compared: case and spacing are not what makes it wrong. */
const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Respell what the glossary lists as a misspelling, as one pass over the text.
 *
 * Compiled once per transcription rather than per cue, like `compileGlossary`.
 * The variants go into a single alternation, longest first, so "Capccio Studio"
 * is respelled whole before "Capccio" can take half of it — and so a term just
 * written in is never read again by a second, shorter variant.
 *
 * Case-insensitive on purpose: the recogniser capitalises by sentence position,
 * and "capccio" mid-sentence is the same mistake as "Capccio" at the start.
 * Words inside a variant match across any whitespace, line breaks included, so
 * the caller must reflow whatever it changes.
 */
export function compileVariants(entries: readonly Spelling[] = []): (text: string) => string {
  const canonical = new Map<string, string>()
  for (const entry of entries) {
    const term = entry?.term?.trim()
    if (!term) continue
    for (const variant of entry.variants ?? []) {
      const key = fold(variant)
      // First entry wins when two claim the same misspelling; the panel lists them in order.
      if (key && !canonical.has(key)) canonical.set(key, term)
    }
  }
  if (!canonical.size) return text => text

  const alternatives = [...canonical.keys()]
    .sort((a, b) => b.length - a.length)
    .map(key => key.split(' ').map(escapeRe).join('\\s+'))
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu')

  return text => text.replace(re, match => canonical.get(fold(match)) ?? match)
}

/** Scribe's limits on one keyterm: under 50 characters, at most five words, none of these. */
const KEYTERM_MAX_CHARS = 50
const KEYTERM_MAX_WORDS = 5
const KEYTERM_FORBIDDEN = /[<>{}[\]\\]/
const MAX_KEYTERMS = 1_000

/**
 * The glossary as Scribe keyterms: what the recogniser should expect to hear.
 *
 * Only the terms. A term is spelt in the language of the audio; a translation
 * is a word nobody in it says, and a variant is the spelling this exists to
 * prevent. A term outside Scribe's limits is left out rather than sent — it
 * still governs the translation, it just cannot steer the ear.
 */
export function keyterms(entries: readonly Spelling[] = []): string[] {
  const out = new Set<string>()
  for (const entry of entries) {
    const term = entry?.term?.trim().replace(/\s+/g, ' ') ?? ''
    if (!term || term.length >= KEYTERM_MAX_CHARS || KEYTERM_FORBIDDEN.test(term)) continue
    if (term.split(' ').length > KEYTERM_MAX_WORDS) continue
    out.add(term)
  }
  return [...out].slice(0, MAX_KEYTERMS)
}
