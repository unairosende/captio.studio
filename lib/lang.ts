import { LANG_CODES } from './providers.ts'

/**
 * Languages as the interface says them, and a sequence in one line.
 *
 * `Spanish` becomes `ES`, a bare code becomes itself in capitals, and anything
 * else stays as written. The one line — «8 cues · ES → EN · FR» — is what the
 * project page and the client's list of sequences both print, so it is written
 * once, here, rather than once in each.
 */
export const shortLang = (lang: string): string =>
  LANG_CODES[lang] ?? (lang.length <= 3 ? lang.toUpperCase() : lang)

/** The source language, or null while it is still to be detected. */
export const knownSource = (lang: string | null): string | null =>
  lang && lang !== 'Auto-detect' ? lang : null

export function describeSequence(q: { cue_count: number; source_lang: string | null; target_langs: string[] }): string {
  const src = knownSource(q.source_lang)
  const from = src ? shortLang(src) : null
  const targets = q.target_langs.map(shortLang).join(' · ')
  const langs = from && targets ? `${from} → ${targets}` : (from ?? targets)
  return [`${q.cue_count.toLocaleString('es-ES')} cues`, langs].filter(Boolean).join(' · ')
}
