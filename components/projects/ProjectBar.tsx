'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

/**
 * Saving, and getting work back.
 *
 * Until now the editor lost everything on reload, which is the first thing
 * anybody would report and the last they would forgive. The table, the version
 * counter and the organisation scoping have been in place for a while; this is
 * the part a person touches.
 *
 * Saving is explicit rather than automatic. Autosave over a shared project
 * would turn every stray keystroke into a change somebody else has to notice,
 * and the conflict handling below only makes sense when a save is a decision.
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
  data?: {
    subtitles?: Subtitle[]
    translations?: TranslationStore
    /** Absent in every project saved before the glossary existed. */
    glossary?: GlossaryEntry[]
  }
}

export default function ProjectBar() {
  const {
    subtitles, translations, srcLang, glossary,
    projectId, projectName, projectVersion, dirty, anchorOps,
    openProject, markSaved, newProject, setProjectName, setComments,
  } = useSubtitleStore()

  const [list, setList] = useState<Summary[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when somebody else saved first, so the choice stays theirs to make. */
  const [conflict, setConflict] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects')
    if (!res.ok) return
    setList((await res.json()).projects ?? [])
  }, [])

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
    setBusy(true)
    setError(null)

    const payload = {
      name: projectName.trim() || 'Untitled',
      sourceLang: srcLang,
      targetLangs: Object.keys(translations),
      data: { subtitles, translations, glossary },
      // Omitted when forcing, which is how "overwrite" gets past the guard.
      ...(projectId && !force ? { version: projectVersion } : {}),
      // The cue splits and deletions since the last save, so the comments are
      // renumbered in the same transaction as the cues they are about. A brand
      // new project has nothing to renumber.
      ...(projectId && anchorOps.length ? { anchorOps } : {}),
    }

    const res = await fetch(projectId ? `/api/projects/${projectId}` : '/api/projects', {
      method: projectId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (res.status === 409) {
      setConflict(true)
      return
    }
    if (!res.ok) {
      setError(json.error ?? `Could not save (HTTP ${res.status})`)
      return
    }

    const saved: Saved = json.project
    setConflict(false)
    markSaved(saved.id, saved.name, saved.version)
  }

  async function load(id: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${id}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(json.error ?? 'Could not open that project')
      return
    }

    const p: Saved = json.project
    openProject({
      id: p.id,
      name: p.name,
      version: p.version,
      subtitles: p.data?.subtitles ?? [],
      translations: p.data?.translations ?? {},
      glossary: p.data?.glossary ?? [],
    })
    setConflict(false)
    setOpen(false)

    // After the cues, not with them: the notes are a separate table, and a
    // project that fails to hand over its comments should still open.
    const notes = await fetch(`/api/projects/${id}/comments`)
    setComments(notes.ok ? (await notes.json()).comments ?? [] : [])
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
      <input
        className="field"
        style={{ width: 150, padding: '3px 7px' }}
        value={projectName}
        onChange={e => setProjectName(e.target.value)}
        aria-label="Project name"
      />

      {/* Unsaved work says so. A dot is enough; a banner would be nagging. */}
      <span
        title={dirty ? 'Unsaved changes' : 'Saved'}
        style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: dirty ? 'var(--amber)' : 'var(--green)',
        }}
      />

      <button className="btn" data-cmd="Save the project" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>

      <button className="btn" data-cmd="Open a project" onClick={() => setOpen(v => !v)}>
        Projects
      </button>

      <button
        className="btn"
        data-cmd="Start a new project"
        onClick={() => {
          if (dirty && !confirm('Discard unsaved changes?')) return
          newProject()
          setOpen(false)
        }}
      >
        New
      </button>

      {error && <span className="err">{error}</span>}

      {conflict && projectId && (
        <div
          style={{
            position: 'absolute', top: 34, left: 0, zIndex: 20, width: 330, padding: 12,
            borderRadius: 7, border: '1px solid var(--red)', background: 'var(--bg2)',
            fontSize: 12, color: 'var(--text2)', lineHeight: 1.5,
          }}
        >
          Somebody else saved this project after you opened it. Saving now would
          erase their work.
          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            <button className="btn" onClick={() => void load(projectId)}>Load theirs</button>
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
              Nothing saved yet
            </div>
          )}
          {list.map(p => (
            <button
              key={p.id}
              onClick={() => {
                if (dirty && !confirm('Discard unsaved changes?')) return
                void load(p.id)
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12,
                background: p.id === projectId ? 'var(--accent-dim)' : 'transparent',
                color: p.id === projectId ? '#8ba8ff' : 'var(--text2)',
              }}
            >
              {p.name}
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)' }}>
                {new Date(p.updated_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
