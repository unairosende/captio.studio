'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ago } from '@/lib/ago'
import { api, send } from '@/lib/api'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import type { ProjectSummary } from '@/lib/db/projects'
import type { ReviewLinkSummary } from '@/lib/db/review-links'
import type { SequenceSummary } from '@/lib/db/sequences'
import { describeSequence, shortLang } from '@/lib/lang'

import ReviewLinks from './ReviewLinks'
import s from './project.module.css'

interface Props {
  project: ProjectSummary
  sequences: SequenceSummary[]
  links: ReviewLinkSummary[]
}

/**
 * The inside of a project: its sequences, the client's way in, and the
 * terms every sequence obeys.
 *
 * The glossary sits on this page rather than only in the editor because it
 * is the thing the project exists to hold. Somebody setting up a job spells
 * the character names once, here, before anybody starts on reel one.
 */
export default function ProjectClient({ project, sequences, links }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [terms, setTerms] = useState<GlossaryEntry[]>(project.glossary ?? [])
  const [savingTerms, setSavingTerms] = useState(false)
  const [savedTerms, setSavedTerms] = useState(false)

  /**
   * Renaming, inline rather than through `prompt()`.
   *
   * The browser dialog is not something to rely on: it is blocked outright in
   * a sandboxed frame, browsers disable it after a page uses it a few times,
   * and a refused call throws — which turns the button into one that silently
   * does nothing while looking perfectly fine.
   */
  async function rename(next: string) {
    const name = next.trim()
    setRenaming(false)
    if (!name || name === project.name) return

    const r = await send(`/api/projects/${project.id}`, { name }, 'PATCH')
    if (!r.ok) {
      setError(r.error)
      return
    }
    router.refresh()
  }

  async function saveTerms(next: GlossaryEntry[]) {
    setTerms(next)
    setSavingTerms(true)
    setSavedTerms(false)
    setError(null)

    // Blank rows are dropped server-side; sending them keeps the row on
    // screen while somebody is still typing into it.
    const r = await send(`/api/projects/${project.id}`, { glossary: next }, 'PATCH')
    setSavingTerms(false)

    if (!r.ok) {
      setError(r.error)
      return
    }
    setSavedTerms(true)
  }

  async function removeSequence(sequence: SequenceSummary) {
    if (!confirm(`¿Borrar «${sequence.name}»? Sus subtítulos y sus comentarios se van con ella.`)) return

    setBusyId(sequence.id)
    setError(null)
    const r = await api(`/api/sequences/${sequence.id}`, { method: 'DELETE' })
    setBusyId(null)

    if (!r.ok) {
      setError(r.error)
      return
    }

    router.refresh()
  }

  const newSequence = () => router.push(`/translate?project=${project.id}`)

  return (
    <div className={s.page}>
      <header className={`topbar ${s.head}`}>
        <Link href="/dashboard" className="brand">captio</Link>
        <span className="topbar-sep" />
        <nav className="crumbs" aria-label="Dónde estás">
          <Link href="/dashboard">Proyectos</Link>
          <span>/</span>
          <span>{project.name}</span>
        </nav>
      </header>

      <main className={s.main}>
        <div className={s.title}>
          {renaming ? (
            <input
              className={`field ${s.rename}`}
              autoFocus
              value={draftName}
              aria-label="Nombre del proyecto"
              onChange={e => setDraftName(e.target.value)}
              onBlur={() => void rename(draftName)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void rename(draftName) }
                if (e.key === 'Escape') { setDraftName(project.name); setRenaming(false) }
              }}
            />
          ) : (
            <>
              <h1>{project.name}</h1>
              <button className="btn btn-quiet" onClick={() => { setDraftName(project.name); setRenaming(true) }}>Renombrar</button>
            </>
          )}
        </div>
        <div className={s.meta}>
          {sequences.length} {sequences.length === 1 ? 'secuencia' : 'secuencias'}
          {project.cue_count > 0 && ` · ${project.cue_count.toLocaleString('es-ES')} cues`}
          {project.target_langs.length > 0 && ` · ${project.target_langs.map(shortLang).join(' · ')}`}
        </div>

        {error && <div className={`err ${s.err}`}>{error}</div>}

        {/* ── Secuencias ─────────────────────────────────────────────────── */}
        <div className={s.sectionHead}>
          <h2>Secuencias</h2>
          <span className={s.spacer} />
          <button className="btn btn-primary btn-lg" onClick={newSequence}>Nueva secuencia</button>
        </div>

        {sequences.length === 0 ? (
          <div className="card">
            <div className="empty">
              <span className="empty-title">Nada en este proyecto todavía</span>
              <p>Una secuencia es una pista de subtítulos — un rollo, un episodio, un corte. Transcribe un archivo o importa un SRT, y guárdalo aquí.</p>
              <button className="btn btn-primary" onClick={newSequence}>Empezar una</button>
            </div>
          </div>
        ) : (
          <div className={s.grid}>
            {sequences.map(q => (
              <div key={q.id} className={`card ${s.seqCard}`}>
                <button className={s.seqOpen} onClick={() => router.push(`/translate?sequence=${q.id}`)}>
                  <div className={s.seqName}>{q.name}</div>
                  <div className={s.seqMeta}>{describeSequence(q)}</div>
                </button>
                <div className={s.seqFoot}>
                  <span className={s.seqAgo} suppressHydrationWarning>{ago(q.updated_at)}</span>
                  <span className={s.spacer} />
                  {/* Every language side by side, with the client's notes: the
                      view the client gets through a link, opened from inside. */}
                  <button className="btn btn-quiet" onClick={() => router.push(`/review/${q.id}`)}>Revisión</button>
                  <button className="btn btn-danger" disabled={busyId === q.id} aria-busy={busyId === q.id || undefined} onClick={() => void removeSequence(q)}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* The client's way in. Below the sequences because it opens all of
            them, and above the glossary because it is used far more often. */}
        <ReviewLinks projectId={project.id} initial={links} />

        {/* ── Glosario ────────────────────────────────────────────────────
            Here rather than only in the editor because it is what makes this
            a project and not a folder: one list of terms, obeyed by every
            sequence in it. Saved on blur rather than on every keystroke — this
            is shared, and a PATCH per character would be a fight between two
            people typing at once. */}
        <div className={s.sectionHead}>
          <h2>Glosario</h2>
          <span className={s.spacer} />
          <span className="muted">
            {savingTerms ? 'Guardando…' : savedTerms ? 'Guardado' : `${terms.length} ${terms.length === 1 ? 'término' : 'términos'}`}
          </span>
        </div>
        <div className="card">
          <div className={s.hint}>
            Cada secuencia de este proyecto traduce estos términos igual. Deja la traducción vacía para conservar el término tal cual.
          </div>
          {terms.length > 0 && (
            <div className={s.terms}>
              {terms.map((entry, i) => (
                <div key={i} className={s.term}>
                  <input
                    className="field"
                    value={entry.term}
                    placeholder="Término"
                    aria-label="Término"
                    spellCheck={false}
                    onChange={e => setTerms(terms.map((t, j) => (j === i ? { ...t, term: e.target.value } : t)))}
                    onBlur={() => void saveTerms(terms)}
                  />
                  <input
                    className="field"
                    value={entry.translation ?? ''}
                    placeholder="Tal cual"
                    aria-label="Traducción"
                    spellCheck={false}
                    onChange={e => setTerms(terms.map((t, j) => (j === i ? { ...t, translation: e.target.value } : t)))}
                    onBlur={() => void saveTerms(terms)}
                  />
                  <button className="btn btn-danger" aria-label={`Quitar ${entry.term || 'el término'}`} onClick={() => void saveTerms(terms.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn" style={{ marginTop: terms.length ? 0 : 'var(--sp-3)' }} onClick={() => setTerms([...terms, { term: '', translation: '' }])}>Añadir término</button>
        </div>
      </main>
    </div>
  )
}
