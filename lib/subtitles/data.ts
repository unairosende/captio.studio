import type { Subtitle } from './types.ts'

/**
 * The stored shape of a sequence, and the one edit a reviewer may make to it.
 *
 * `sequences.data` is free-form jsonb: `{}` for a sequence created straight
 * through the API, `{ subtitles, translations }` for one the editor saved, and
 * whatever an older save left behind. Everything that reads it comes through
 * `readCues`, so the checking happens once.
 */

export type Translations = Record<string, Subtitle[]>

export interface SequenceCues {
  subtitles: Subtitle[]
  translations: Translations
}

/** `data` is free-form jsonb, so what comes back is checked rather than trusted. */
export function readCues(data: unknown): SequenceCues {
  const blob = (data ?? {}) as { subtitles?: unknown; translations?: unknown }
  return {
    subtitles: Array.isArray(blob.subtitles) ? (blob.subtitles as Subtitle[]) : [],
    translations:
      blob.translations && typeof blob.translations === 'object' && !Array.isArray(blob.translations)
        ? (blob.translations as Translations)
        : {},
  }
}

/** One line rewritten, in one language. `'source'` is the original. */
export interface TextEdit {
  lang: 'source' | string
  index: number
  text: string
}

export class UnknownCueError extends Error {
  readonly status = 400
  constructor(edit: TextEdit) {
    super(`There is no subtitle ${edit.index} in ${edit.lang}`)
    this.name = 'UnknownCueError'
  }
}

/**
 * Rewrite the text of some cues and nothing else.
 *
 * This is the whole of what a client may do to a track: change what a line
 * says. Timings, numbering, the set of languages and the count of cues all come
 * out exactly as they went in — so a reviewer can never leave the Spanish one
 * cue longer than the English, which is the one mistake nothing downstream
 * would catch. An edit naming a cue or a language that is not there is refused
 * outright rather than skipped: the reviewer typed it against a track that has
 * since changed shape, and silently dropping it would tell them it was saved.
 */
export function applyTextEdits(
  subtitles: Subtitle[],
  translations: Translations,
  edits: TextEdit[],
): SequenceCues {
  const out: SequenceCues = { subtitles, translations: { ...translations } }

  for (const edit of edits) {
    const track = edit.lang === 'source' ? out.subtitles : out.translations[edit.lang]
    if (!track) throw new UnknownCueError(edit)

    const at = track.findIndex(s => s.index === edit.index)
    if (at === -1) throw new UnknownCueError(edit)

    const next = track.slice()
    next[at] = { ...track[at], text: edit.text }
    if (edit.lang === 'source') out.subtitles = next
    else out.translations[edit.lang] = next
  }

  return out
}
