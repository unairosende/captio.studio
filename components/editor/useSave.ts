'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { api, send } from '@/lib/api'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { ProjectComment } from '@/types/comment'
import type { Playback } from '@/types/media'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

export interface SequenceSummary {
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
    glossary?: GlossaryEntry[]
  }
}

/**
 * Saving, and what can go wrong with it.
 *
 * The version travels with the save so the server can refuse to overwrite
 * somebody else's work; a 409 becomes a question rather than a silent loss.
 * The anchor operations travel with it too — comments point at cue numbers,
 * and the numbers moved.
 */
export function useSave() {
  const {
    glossary, projectId, projectName, sequenceId, dirty,
    openSequence, markSaved, newSequence, setComments,
  } = useSubtitleStore()

  const flying = useRef(false)
  const [list, setList] = useState<SequenceSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    const r = await api<{ sequences?: SequenceSummary[] }>(`/api/sequences?project=${projectId}`)
    if (r.ok) setList(r.json.sequences ?? [])
  }, [projectId])

  /** Warn before losing work to a reload or a closed tab. */
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save(force = false) {
    // Read now rather than from the last render: an autosave fires from a
    // timer, and what goes is what is there when it fires.
    const st = useSubtitleStore.getState()
    if (!st.subtitles.length) { setError('Todavía no hay nada que guardar'); return }
    if (!st.projectId) { setError('Ábrelo desde un proyecto'); return }
    // One at a time: a second request carrying the same version would come
    // back 409 against the first, and call the user's own save somebody else's.
    if (flying.current) return
    flying.current = true
    setBusy(true)
    setError(null)

    const id = st.sequenceId
    const payload = {
      name: st.sequenceName.trim() || 'Sin título',
      sourceLang: st.srcLang,
      targetLangs: Object.keys(st.translations),
      data: { subtitles: st.subtitles, translations: st.translations },
      ...(id ? {} : { projectId: st.projectId }),
      ...(id && !force ? { version: st.sequenceVersion } : {}),
      ...(id && st.anchorOps.length ? { anchorOps: st.anchorOps } : {}),
      ...(st.mediaId ? { mediaId: st.mediaId } : {}),
    }
    const r = await send<{ sequence: Saved }>(id ? `/api/sequences/${id}` : '/api/sequences', payload, id ? 'PATCH' : 'POST')

    if (!r.ok) {
      flying.current = false
      setBusy(false)
      if (r.status === 409) setConflict(true); else setError(r.error)
      return
    }

    if (st.glossaryDirty) {
      const terms = await send(`/api/projects/${st.projectId}`, { glossary: st.glossary }, 'PATCH')
      if (!terms.ok) setError(`Guardado, pero el glosario no subió: ${terms.error}`)
    }

    setBusy(false)
    const saved = r.json.sequence
    setConflict(false)
    setSavedAt(new Date())
    markSaved(saved.id, saved.name, saved.version, st)
    flying.current = false
  }

  async function load(id: string) {
    setBusy(true)
    setError(null)
    const r = await api<{ sequence: Saved; playback?: Playback | null }>(`/api/sequences/${id}`)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }

    const s = r.json.sequence
    openSequence({
      id: s.id,
      name: s.name,
      version: s.version,
      projectId: s.project_id,
      projectName,
      subtitles: s.data?.subtitles ?? [],
      translations: s.data?.translations ?? {},
      glossary,
      playback: r.json.playback ?? null,
    })
    setConflict(false)
    const notes = await api<{ comments?: ProjectComment[] }>(`/api/sequences/${id}/comments`)
    setComments(notes.ok ? notes.json.comments ?? [] : [])

  }

  function startNew() {
    if (dirty && !confirm('¿Descartar los cambios sin guardar?')) return
    if (!projectId) { setError('Ábrelo desde un proyecto'); return }
    newSequence({ id: projectId, name: projectName, glossary })
  }

  return { list, refresh, busy, error, conflict, setConflict, savedAt, dirty, sequenceId, save, load, startNew }
}
