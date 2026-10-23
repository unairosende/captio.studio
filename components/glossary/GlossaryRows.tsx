'use client'

import type { GlossaryEntry } from '@/lib/ai/prompt'

import s from './glossary.module.css'

interface Props {
  entries: GlossaryEntry[]
  /** Every keystroke. */
  onChange: (entries: GlossaryEntry[]) => void
  /**
   * When a field is left or a row removed — where a list that lives on the
   * server is saved. A PATCH per keystroke would be two colleagues typing into
   * the same shared row and taking turns to overwrite each other.
   */
  onCommit?: (entries: GlossaryEntry[]) => void
}

/**
 * A glossary's rows: the term, how it is translated, and how the transcription
 * misspells it.
 *
 * One piece for three lists — the project's in the editor, which lives in the
 * store and is saved with the sequence, and the project's and the client's on
 * the project page, which are saved as soon as a field is left.
 */
export default function GlossaryRows({ entries, onChange, onCommit }: Props) {
  if (!entries.length) return null

  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const commit = () => onCommit?.(entries)
  const remove = (i: number) => {
    const next = entries.filter((_, j) => j !== i)
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div className={s.rows}>
      {entries.map((entry, i) => (
        <div key={i} className={s.row}>
          <input
            className="field"
            value={entry.term}
            placeholder="Término"
            aria-label="Término"
            spellCheck={false}
            onChange={e => update(i, { term: e.target.value })}
            onBlur={commit}
          />
          <input
            className="field"
            value={entry.translation ?? ''}
            placeholder="Tal cual"
            aria-label="Traducción"
            spellCheck={false}
            onChange={e => update(i, { translation: e.target.value })}
            onBlur={commit}
          />
          <button className="btn btn-quiet" aria-label={`Quitar ${entry.term || 'el término'}`} onClick={() => remove(i)}>×</button>
          <input
            className={`field ${s.variants}`}
            // Split and joined around commas so that what is typed is what is shown;
            // the blanks and stray spaces this keeps are dropped by the server.
            value={(entry.variants ?? []).join(', ')}
            placeholder="Variantes, separadas por comas"
            aria-label="Variantes mal escritas"
            spellCheck={false}
            onChange={e => update(i, { variants: e.target.value.split(/\s*,\s*/) })}
            onBlur={commit}
          />
        </div>
      ))}
    </div>
  )
}
