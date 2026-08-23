'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

/**
 * Saving, and getting work back.
 *
 * What this saves is a sequence — one subtitle track — inside the project the
 * editor was opened from. The dropdown lists the other sequences in that same
 * project, because that is the set somebody actually moves between: reel two
 * after reel one, not a different client's film.
 *
 * Saving is explicit rather than automatic. Autosave over shared work would turn
 * every stray keystroke into a change somebody else has to notice, and the
 * conflict handling below only makes sense when a save is a decision.
 */

interface Summary {
  id: string
  name: string
  updated_at: string
}

interface Saved {
  id: string
  name: string
  version: number
  project_id: string
  data?: {
    subtitles?: Subtitle[]
    translations?: TranslationStore
    /** Absent in every sequence saved before the glossary moved to the project. */
    glossary?: GlossaryEntry[]
  }
}

export default function SequenceBar() {
  const {
    subtitles, translations, srcLang, glossary, glossaryDirty,
    projectId, projectName,
    sequenceId, sequenceName, sequenceVersion, dirty, anchorOps, mediaId,
    openSequence, markSaved, newSequence, setSequenceName, setComments,
  } = useSubtitleStore()

  const [list, setList] = useState<Summary[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when somebody else saved first, so the choice stays theirs to make. */
  const [conflict, setConflict] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) return
    const res = await fetch(`/api/sequences?project=${projectId}`)
    if (!res.ok) return
    setList((await res.json()).sequences ?? [])
  }, [projectId])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  /** Warn before losing work to a reload or a closed tab. */
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save(force = false) {
    if (!subtitles.length) {
      setError('Nothing to save yet')
      return
    }
    if (!projectId) {
      setError('Open this from a project first')
      return
    }
    setBusy(true)
    setError(null)

    const payload = {
      name: sequenceName.trim() || 'Untitled',
      sourceLang: srcLang,
      targetLangs: Object.keys(translations),
      data: { subtitles, translations },
      ...(sequenceId ? {} : { projectId }),
      // Omitted when forcing, which is how "overwrite" gets past the guard.
      ...(sequenceId && !force ? { version: sequenceVersion } : {}),
      // The cue splits and deletions since the last save, so the comments are
      // renumbered in the same transaction as the cues they are about. A brand
      // new sequence has nothing to renumber.
      ...(sequenceId && anchorOps.length ? { anchorOps } : {}),
      // The recording this track was transcribed from, when there is one. The
      // server uses it to attach the upload to the sequence — without which the
      // nightly sweeper counts the audio as abandoned and deletes it — and to
      // mark the sequence as already paid for, so translating it does not
      // charge again for minutes the audio was charged for.
      ...(mediaId ? { mediaId } : {}),
    }

    const res = await fetch(sequenceId ? `/api/sequences/${sequenceId}` : '/api/sequences', {
      method: sequenceId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await res.json().catch(() => ({}))

    if (res.status === 409) {
      setBusy(false)
      setConflict(true)
      return
    }
    if (!res.ok) {
      setBusy(false)
      setError(json.error ?? `Could not save (HTTP ${res.status})`)
      return
    }

    // The terms live on the project, so they travel separately — and only when
    // somebody has actually edited them. Writing the local copy back on every
    // save would let a person who never opened the panel quietly undo a term a
    // colleague added while they had the editor open.
    if (glossaryDirty) {
      const terms = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ glossary }),
      })
      if (!terms.ok) {
        // The cues are saved; saying otherwise would be worse than saying this.
        setError('Saved, but the glossary did not go up')
      }
    }

    setBusy(false)
    const saved: Saved = json.sequence
    setConflict(false)
    markSaved(saved.id, saved.name, saved.version)
  }

  async function load(id: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sequences/${id}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(json.error ?? 'Could not open that sequence')
      return
    }

    const s: Saved = json.sequence
    openSequence({
      id: s.id,
      name: s.name,
      version: s.version,
      // Staying inside the same project, so its name is already on screen.
      projectId: s.project_id,
      projectName,
      subtitles: s.data?.subtitles ?? [],
      translations: s.data?.translations ?? {},
      // Kept, not taken from the sequence: the terms belong to the project, and
      // this is a move between two sequences of the same one.
      glossary,
    })
    setConflict(false)
    setOpen(false)

    // After the cues, not with them: the notes are a separate table, and a
    // sequence that fails to hand over its comments should still open.
    const notes = await fetch(`/api/sequences/${id}/comments`)
    setComments(notes.ok ? (await notes.json()).comments ?? [] : [])
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
      <input
        className="field"
        style={{ width: 150, padding: '3px 7px' }}
        value={sequenceName}
        onChange={e => setSequenceName(e.target.value)}
        aria-label="Sequence name"
      />

      {/* Unsaved work says so. A dot is enough; a banner would be nagging. */}
      <span
        title={dirty ? 'Unsaved changes' : 'Saved'}
        style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: dirty ? 'var(--amber)' : 'var(--green)',
        }}
      />

      <button className="btn" data-cmd="Save the sequence" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>

      <button className="btn" data-cmd="Open another sequence" onClick={() => setOpen(v => !v)}>
        Sequences
      </button>

      <button
        className="btn"
        data-cmd="Start a new sequence"
        onClick={() => {
          if (dirty && !confirm('Discard unsaved changes?')) return
          if (!projectId) {
            setError('Open this from a project first')
            return
          }
          newSequence({ id: projectId, name: projectName, glossary })
          setOpen(false)
        }}
      >
        New
      </button>

      {error && <span className="err">{error}</span>}

      {conflict && sequenceId && (
        <div
          style={{
            position: 'absolute', top: 34, left: 0, zIndex: 20, width: 330, padding: 12,
            borderRadius: 7, border: '1px solid var(--red)', background: 'var(--bg2)',
            fontSize: 12, color: 'var(--text2)', lineHeight: 1.5,
          }}
        >
          Somebody else saved this sequence after you opened it. Saving now would
          erase their work.
          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            <button className="btn" onClick={() => void load(sequenceId)}>Load theirs</button>
            <button className="btn btn-danger" onClick={() => void save(true)}>Overwrite</button>
            <button className="btn" onClick={() => setConflict(false)}>Cancel</button>
          </div>
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'absolute', top: 34, left: 0, zIndex: 20, width: 280,
            maxHeight: 320, overflowY: 'auto', padding: 5, borderRadius: 7,
            border: '1px solid var(--border2)', background: 'var(--bg2)',
          }}
        >
          {list.length === 0 && (
            <div style={{ padding: 10, fontSize: 11, color: 'var(--text3)' }}>
              Nothing saved in this project yet
            </div>
          )}
          {list.map(s => (
            <button
              key={s.id}
              onClick={() => {
                if (dirty && !confirm('Discard unsaved changes?')) return
                void load(s.id)
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12,
                background: s.id === sequenceId ? 'var(--accent-dim)' : 'transparent',
                color: s.id === sequenceId ? '#8ba8ff' : 'var(--text2)',
              }}
            >
              {s.name}
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)' }}>
                {new Date(s.updated_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
