'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ago } from '@/lib/ago'
import { api, send } from '@/lib/api'
import GlossaryRows from '@/components/glossary/GlossaryRows'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import type { ClientOption } from '@/lib/db/clients'
import type { ProjectSummary } from '@/lib/db/projects'
import type { ReviewLinkSummary } from '@/lib/db/review-links'
import type { SequenceSummary } from '@/lib/db/sequences'
import { describeSequence, shortLang } from '@/lib/lang'
import { suggestionKey, type VariantSuggestion } from '@/lib/subtitles'

import ReviewLinks from './ReviewLinks'
import s from './project.module.css'

interface Props {
  project: ProjectSummary
  sequences: SequenceSummary[]
  links: ReviewLinkSummary[]
  /** Every client of the organisation, for the picker. */
  clients: ClientOption[]
  /** The one this project is filed under, with the glossary it inherits. */
  client: { id: string; name: string; glossary: GlossaryEntry[] } | null
  /** Corrections the team keeps making to transcriptions, offered as variants. */
  suggestions: VariantSuggestion[]
}

/**
 * The inside of a project: its sequences, the client's way in, and the
 * terms every sequence obeys.
 *
 * The glossary sits on this page rather than only in the editor because it
 * is the thing the project exists to hold. Somebody setting up a job spells
 * the character names once, here, before anybody starts on reel one.
 */
export default function ProjectClient({ project, sequences, links, clients, client, suggestions }: Props) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [naming, setNaming] = useState(false)
  const [clientName, setClientName] = useState('')
  const [assigning, setAssigning] = useState(false)
  // The suggestion being filed or declined, by its key.
  const [deciding, setDeciding] = useState<string | null>(null)

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

  /** File the project under a client, or under nobody. The page reloads with its glossary. */
  async function assign(clientId: string | null) {
    setAssigning(true)
    setError(null)
    const r = await send(`/api/projects/${project.id}`, { clientId }, 'PATCH')
    setAssigning(false)

    if (!r.ok) {
      setError(r.error)
      return
    }
    router.refresh()
  }

  /**
   * File a suggestion as a variant — into this project's glossary or the
   * client's — or decline it for good. Either way it leaves the list.
   */
  async function decide(s: VariantSuggestion, into: 'project' | 'client' | 'dismiss') {
    setDeciding(suggestionKey(s))
    setError(null)
    const pick = { term: s.term, variant: s.variant }
    const r =
      into === 'dismiss'
        ? await send(`/api/projects/${project.id}`, { dismissVariant: suggestionKey(s) }, 'PATCH')
        : into === 'client' && client
          ? await send(`/api/clients/${client.id}`, { addVariant: pick }, 'PATCH')
          : await send(`/api/projects/${project.id}`, { addVariant: pick }, 'PATCH')
    setDeciding(null)

    if (!r.ok) {
      setError(r.error)
      return
    }
    router.refresh()
  }

  async function createClient() {
    const name = clientName.trim()
    if (!name) return

    setAssigning(true)
    setError(null)
    const r = await send<{ client: { id: string } }>('/api/clients', { name })
    if (!r.ok) {
      setAssigning(false)
      setError(r.error)
      return
    }
    setNaming(false)
    setClientName('')
    await assign(r.json.client.id)
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
          {client && `Para ${client.name} · `}
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

        {/* ── Cliente ─────────────────────────────────────────────────────
            Above the glossaries because it decides whether there are one or
            two of them. Optional: plenty of work is one-off. */}
        <div className={s.sectionHead}>
          <h2>Cliente</h2>
        </div>
        <div className={`card ${s.stack}`}>
          <div className={s.hint}>
            Los proyectos de un mismo cliente comparten su glosario: lo que se fija en uno vale en los siguientes.
          </div>
          <div className={s.client}>
            <div className={`select-wrap ${s.pick}`}>
              <select
                className="field"
                aria-label="Cliente"
                value={naming ? NEW_CLIENT : project.client_id ?? ''}
                disabled={assigning}
                aria-busy={assigning || undefined}
                onChange={e => {
                  if (e.target.value === NEW_CLIENT) { setNaming(true); return }
                  setNaming(false)
                  void assign(e.target.value || null)
                }}
              >
                <option value="">Sin cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW_CLIENT}>Nuevo cliente…</option>
              </select>
            </div>
            {naming && (
              <>
                <input
                  className={`field ${s.pick}`}
                  autoFocus
                  value={clientName}
                  placeholder="Nombre del cliente"
                  aria-label="Nombre del cliente nuevo"
                  onChange={e => setClientName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void createClient() }
                    if (e.key === 'Escape') { setNaming(false); setClientName('') }
                  }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!clientName.trim() || assigning}
                  aria-busy={assigning || undefined}
                  onClick={() => void createClient()}
                >
                  Crear
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Sugerencias ─────────────────────────────────────────────────
            Only when there are any. Above the glossaries because accepting
            one changes them, and the change should land in view. */}
        {suggestions.length > 0 && (
          <>
            <div className={s.sectionHead}>
              <h2>Sugerencias</h2>
              <span className={s.spacer} />
              <span className="muted">{suggestions.length}</span>
            </div>
            <div className={`card ${s.stack}`}>
              <div className={s.hint}>
                Correcciones que el equipo ha hecho a mano más de una vez en las transcripciones
                {client ? ` de ${client.name}` : ''}. Como variante, las próximas transcripciones ya saldrán bien escritas.
              </div>
              <div className={s.suggestions}>
                {suggestions.map(sg => {
                  const key = suggestionKey(sg)
                  const busy = deciding === key
                  return (
                    <div key={key} className={s.suggestion}>
                      <span className={s.suggestionText}>
                        «{sg.variant}» → <strong>{sg.term}</strong>
                        <span className="muted"> · {sg.count} veces</span>
                      </span>
                      <button className="btn" disabled={deciding !== null} aria-busy={busy || undefined} onClick={() => void decide(sg, 'project')}>
                        Al proyecto
                      </button>
                      {client && (
                        <button className="btn" disabled={deciding !== null} aria-busy={busy || undefined} onClick={() => void decide(sg, 'client')}>
                          A {client.name}
                        </button>
                      )}
                      <button className="btn btn-quiet" disabled={deciding !== null} onClick={() => void decide(sg, 'dismiss')}>
                        Descartar
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ── Glosarios ───────────────────────────────────────────────────
            Here rather than only in the editor because they are what make
            this a project and not a folder: one list of terms, obeyed by every
            sequence in it — and the client's, obeyed by every project of
            theirs. */}
        <GlossaryCard
          // Remounted when the stored list changes under it — an accepted
          // suggestion — and not when it is only re-rendered.
          key={JSON.stringify(project.glossary)}
          title="Glosario"
          hint="Cada secuencia de este proyecto traduce estos términos igual. Deja la traducción vacía para conservar el término tal cual. La transcripción los espera, y sus variantes mal escritas se corrigen solas."
          initial={project.glossary ?? []}
          url={`/api/projects/${project.id}`}
          onError={setError}
        />
        {client && (
          <GlossaryCard
            // A different client is a different list, not an edit to this one;
            // and, as above, a stored list that changed is a fresh start.
            key={`${client.id}:${JSON.stringify(client.glossary)}`}
            title={`Glosario de ${client.name}`}
            hint={`Lo heredan todos los proyectos de ${client.name}. Donde un término coincide con el glosario del proyecto, gana el del proyecto.`}
            initial={client.glossary ?? []}
            url={`/api/clients/${client.id}`}
            onError={setError}
          />
        )}
      </main>
    </div>
  )
}

/** What the client picker answers when somebody wants one that does not exist yet. */
const NEW_CLIENT = 'new'

/**
 * One glossary, saved where it lives.
 *
 * Saved on blur rather than on every keystroke — these lists are shared, and a
 * PATCH per character would be a fight between two people typing at once.
 */
function GlossaryCard({ title, hint, initial, url, onError }: {
  title: string
  hint: string
  initial: GlossaryEntry[]
  /** The row it belongs to: a project or a client. Both take `{ glossary }`. */
  url: string
  onError: (message: string | null) => void
}) {
  const [terms, setTerms] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save(next: GlossaryEntry[]) {
    setTerms(next)
    setSaving(true)
    setSaved(false)
    onError(null)

    // Blank rows are dropped server-side; sending them keeps the row on
    // screen while somebody is still typing into it.
    const r = await send(url, { glossary: next }, 'PATCH')
    setSaving(false)

    if (!r.ok) {
      onError(r.error)
      return
    }
    setSaved(true)
  }

  return (
    <>
      <div className={s.sectionHead}>
        <h2>{title}</h2>
        <span className={s.spacer} />
        <span className="muted">
          {saving ? 'Guardando…' : saved ? 'Guardado' : `${terms.length} ${terms.length === 1 ? 'término' : 'términos'}`}
        </span>
      </div>
      <div className={`card ${s.stack}`}>
        <div className={s.hint}>{hint}</div>
        <GlossaryRows entries={terms} onChange={setTerms} onCommit={next => void save(next)} />
        <button className={`btn ${s.add}`} onClick={() => setTerms([...terms, { term: '', translation: '' }])}>Añadir término</button>
      </div>
    </>
  )
}
