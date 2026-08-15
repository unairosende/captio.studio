'use client'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { useSubtitleStore } from '@/store/useSubtitleStore'

/**
 * The terms the translation must respect.
 *
 * This is what separates a translation a production company can deliver from
 * one it has to check line by line: character names, brands and the client's
 * own vocabulary come out the same in cue 4 and in cue 900, in every language.
 * The model is told about them on every request, because each batch is its own
 * conversation and remembers nothing of the last one.
 *
 * Collapsed by default, and native `<details>` rather than a state flag: a
 * glossary is filled in at the start of a job and then left alone.
 */
export default function GlossaryPanel() {
  const { glossary, setGlossary } = useSubtitleStore()

  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    setGlossary(glossary.map((g, j) => (j === i ? { ...g, ...patch } : g)))

  const field = {
    flex: 1, minWidth: 0, background: 'var(--bg0)', border: '1px solid var(--border2)',
    borderRadius: 4, color: 'var(--text)', fontSize: 11, padding: '4px 6px', outline: 'none',
  } as const

  return (
    <details>
      <summary className="caps" style={{ cursor: 'pointer', marginBottom: 9 }}>
        Glossary{glossary.length > 0 && ` · ${glossary.length}`}
      </summary>

      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4, marginBottom: 7 }}>
        Leave the right side empty to keep a term unchanged in every language.
      </div>

      {glossary.map((entry, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            value={entry.term}
            onChange={e => update(i, { term: e.target.value })}
            placeholder="Term"
            spellCheck={false}
            style={field}
          />
          <input
            value={entry.translation ?? ''}
            onChange={e => update(i, { translation: e.target.value })}
            placeholder="Keep as is"
            spellCheck={false}
            style={field}
          />
          <button
            onClick={() => setGlossary(glossary.filter((_, j) => j !== i))}
            title="Remove term"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text3)', borderRadius: 4, fontSize: 10, padding: '0 6px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        onClick={() => setGlossary([...glossary, { term: '', translation: '' }])}
        style={{ width: '100%', marginTop: 4, padding: '5px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)' }}
      >
        + Add term
      </button>
    </details>
  )
}
