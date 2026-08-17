'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import type { ProjectSummary } from '@/lib/db/projects'
import type { SequenceSummary } from '@/lib/db/sequences'
import { LANG_CODES } from '@/lib/providers'

interface Props {
  project: ProjectSummary
  sequences: SequenceSummary[]
}

/** `Spanish` as `ES`, and anything unrecognised as itself. */
const short = (lang: string | null): string => (lang ? (LANG_CODES[lang] ?? lang) : '—')

/**
 * Elapsed time, said the way a person would say it.
 *
 * Relative rather than absolute for the same reason as on the dashboard: a date
 * formatted on a server running in UTC and again in the reader's timezone is two
 * different strings for one instant, which React reports as a hydration
 * mismatch. A difference between two clocks reads the same everywhere.
 */
const RELATIVE = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

function ago(value: string | Date): string {
  const delta = new Date(value).getTime() - Date.now()
  if (Number.isNaN(delta)) return ''
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return RELATIVE.format(Math.round(delta / ms), unit)
  }
  return 'just now'
}

/**
 * The inside of a project: its sequences, and the terms they all obey.
 *
 * The glossary sits on this page rather than only in the editor because it is
 * the thing the project exists to hold. Somebody setting up a job spells the
 * character names once, here, before anybody starts on reel one.
 */
export default function ProjectClient({ project, sequences }: Props) {
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
   * The browser dialog is not something to rely on: it is blocked outright in a
   * sandboxed frame, browsers disable it after a page uses it a few times, and a
   * refused call throws — which turns the button into one that silently does
   * nothing while looking perfectly fine.
   */
  async function rename(next: string) {
    const name = next.trim()
    setRenaming(false)
    if (!name || name === project.name) return

    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Could not rename it')
      return
    }
    router.refresh()
  }

  async function saveTerms(next: GlossaryEntry[]) {
    setTerms(next)
    setSavingTerms(true)
    setSavedTerms(false)
    setError(null)

    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Blank rows are dropped server-side; sending them keeps the row on screen
      // while somebody is still typing into it.
      body: JSON.stringify({ glossary: next }),
    })
    setSavingTerms(false)

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Could not save the glossary')
      return
    }
    setSavedTerms(true)
  }

  async function removeSequence(sequence: SequenceSummary) {
    if (!confirm(`Delete “${sequence.name}”? Its subtitles and comments go with it.`)) return

    setBusyId(sequence.id)
    setError(null)
    const res = await fetch(`/api/sequences/${sequence.id}`, { method: 'DELETE' })
    setBusyId(null)

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? `Could not delete it (HTTP ${res.status})`)
      return
    }
    router.refresh()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <Link href="/dashboard" style={{ fontSize: 'var(--fs-md)', color: 'var(--text3)', textDecoration: 'none' }}>
          ← All projects
        </Link>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '22px 16px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          {renaming ? (
            <input
              className="field"
              style={{ fontSize: 18, width: 360 }}
              autoFocus
              value={draftName}
              aria-label="Project name"
              onChange={e => setDraftName(e.target.value)}
              onBlur={() => void rename(draftName)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void rename(draftName) }
                if (e.key === 'Escape') { setDraftName(project.name); setRenaming(false) }
              }}
            />
          ) : (
            <>
              <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>{project.name}</h1>
              <button
                className="btn btn-quiet"
                onClick={() => { setDraftName(project.name); setRenaming(true) }}
              >
                Rename
              </button>
            </>
          )}
        </div>
        <div className="muted" style={{ marginBottom: 20 }}>
          {sequences.length} sequence{sequences.length === 1 ? '' : 's'}
          {project.cue_count > 0 && ` · ${project.cue_count.toLocaleString('en-GB')} cues`}
          {project.target_langs.length > 0 && ` · ${project.target_langs.map(short).join(' ')}`}
        </div>

        {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 12px' }}>
          <span className="caps">Sequences</span>
          <button
            className="btn btn-primary btn-lg"
            style={{ marginLeft: 'auto' }}
            onClick={() => router.push(`/translate?project=${project.id}`)}
          >
            New sequence
          </button>
        </div>

        {sequences.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '38px 16px' }}>
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text2)' }}>
              Nothing in this project yet
            </div>
            <div className="muted" style={{ marginTop: 5 }}>
              A sequence is one subtitle track — a reel, an episode, a cut.
              Transcribe a file or import an SRT, then save it here.
            </div>
            <button className="btn btn-primary btn-lg" style={{ marginTop: 14 }}
              onClick={() => router.push(`/translate?project=${project.id}`)}>
              Start one
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 12 }}>
            {sequences.map(s => (
              <div key={s.id} className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
                <button
                  onClick={() => router.push(`/translate?sequence=${s.id}`)}
                  style={{
                    flex: 1, textAlign: 'left', padding: '13px 15px 9px',
                    background: 'none', border: 'none', cursor: 'pointer', font: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </div>
                  <div className="muted" style={{ fontFamily: 'var(--mono)', marginTop: 5 }}>
                    {s.cue_count.toLocaleString('en-GB')} cues · {short(s.source_lang)}
                    {s.target_langs.length > 0 && ` → ${s.target_langs.map(short).join(' ')}`}
                  </div>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 15px 11px' }}>
                  <span className="muted" suppressHydrationWarning>{ago(s.updated_at)}</span>
                  <button
                    className="btn btn-quiet btn-danger"
                    style={{ marginLeft: 'auto' }}
                    disabled={busyId === s.id}
                    onClick={() => void removeSequence(s)}
                  >
                    {busyId === s.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Glossary ─────────────────────────────────────────────────────
            Here rather than only in the editor because it is what makes this a
            project and not a folder: one list of terms, obeyed by every
            sequence in it. Saved on blur rather than on every keystroke — this
            is shared, and a PATCH per character would be a fight between two
            people typing at once. */}
        <div className="card" style={{ marginTop: 28 }}>
          <div className="card-head">
            <span className="caps">Glossary</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              {savingTerms ? 'Saving…' : savedTerms ? 'Saved' : `${terms.length} term${terms.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="muted" style={{ marginBottom: 10 }}>
            Every sequence in this project translates these the same way. Leave a
            translation blank to keep the term exactly as written.
          </div>

          {terms.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 6 }}>
              <input
                className="field"
                style={{ flex: 1 }}
                value={entry.term}
                placeholder="Term"
                onChange={e => setTerms(terms.map((t, j) => (j === i ? { ...t, term: e.target.value } : t)))}
                onBlur={() => void saveTerms(terms)}
              />
              <input
                className="field"
                style={{ flex: 1 }}
                value={entry.translation ?? ''}
                placeholder="Leave as written"
                onChange={e => setTerms(terms.map((t, j) => (j === i ? { ...t, translation: e.target.value } : t)))}
                onBlur={() => void saveTerms(terms)}
              />
              <button
                className="btn btn-danger"
                onClick={() => void saveTerms(terms.filter((_, j) => j !== i))}
                aria-label={`Remove ${entry.term || 'term'}`}
              >
                ×
              </button>
            </div>
          ))}

          <button className="btn" style={{ marginTop: 4 }}
            onClick={() => setTerms([...terms, { term: '', translation: '' }])}>
            Add term
          </button>
        </div>
      </div>
    </div>
  )
}
