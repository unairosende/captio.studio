'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { useSubtitleStore } from '@/store/useSubtitleStore'
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
    subtitles, translations, srcLang, glossary, glossaryDirty,
    projectId, projectName,
    sequenceId, sequenceName, sequenceVersion, dirty, anchorOps, mediaId,
    openSequence, markSaved, newSequence, setComments,
  } = useSubtitleStore()

  const [list, setList] = useState<SequenceSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    const res = await fetch(`/api/sequences?project=${projectId}`)
    if (!res.ok) return
    setList((await res.json()).sequences ?? [])
  }, [projectId])

  /** Warn before losing work to a reload or a closed tab. */
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save(force = false) {
    if (!subtitles.length) { setError('Todavía no hay nada que guardar'); return }
    if (!projectId) { setError('Ábrelo desde un proyecto'); return }
    setBusy(true)
    setError(null)

    const payload = {
      name: sequenceName.trim() || 'Sin título',
      sourceLang: srcLang,
      targetLangs: Object.keys(translations),
      data: { subtitles, translations },
      ...(sequenceId ? {} : { projectId }),
      ...(sequenceId && !force ? { version: sequenceVersion } : {}),
      ...(sequenceId && anchorOps.length ? { anchorOps } : {}),
      ...(mediaId ? { mediaId } : {}),
    }
    const res = await fetch(sequenceId ? `/api/sequences/${sequenceId}` : '/api/sequences', {
      method: sequenceId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))

    if (res.status === 409) { setBusy(false); setConflict(true); return }
    if (!res.ok) { setBusy(false); setError(json.error ?? `No se pudo guardar (HTTP ${res.status})`); return }

    if (glossaryDirty) {
      const terms = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ glossary }),
      })
      if (!terms.ok) setError('Guardado, pero el glosario no subió')
    }

    setBusy(false)
    const saved: Saved = json.sequence
    setConflict(false)
    setSavedAt(new Date())
    markSaved(saved.id, saved.name, saved.version)
  }

  async function load(id: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sequences/${id}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? 'No se pudo abrir esa secuencia'); return }

    const s: Saved = json.sequence
    openSequence({
      id: s.id,
      name: s.name,
      version: s.version,
      projectId: s.project_id,
      projectName,
      subtitles: s.data?.subtitles ?? [],
      translations: s.data?.translations ?? {},
      glossary,
      mediaId: typeof json.mediaId === 'string' ? json.mediaId : null,
    })
    setConflict(false)
    const notes = await fetch(`/api/sequences/${id}/comments`)
    setComments(notes.ok ? (await notes.json()).comments ?? [] : [])
  }

  function startNew() {
    if (dirty && !confirm('¿Descartar los cambios sin guardar?')) return
    if (!projectId) { setError('Ábrelo desde un proyecto'); return }
    newSequence({ id: projectId, name: projectName, glossary })
  }

  return { list, refresh, busy, error, conflict, setConflict, savedAt, dirty, sequenceId, save, load, startNew }
}
