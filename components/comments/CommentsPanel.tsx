'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'

import type { ProjectComment } from '@/types/comment'

/**
 * The thread on one cue.
 *
 * Comments are the part of the job that happens between people — a reviewer
 * marking a line, a translator answering — so they are kept out of the subtitle
 * text itself. A note written into the cue reaches the client's screen.
 *
 * Resolving is deliberately not deleting: a settled note is the record of why a
 * line reads the way it does, and the next person to query it deserves to find
 * the answer rather than ask again.
 *
 * Takes the thread and hands back the updated one, rather than reading the
 * editor's store: the same panel opens inside the editor and inside the review
 * view a client sees, and the client has no store, no session and a token in a
 * header instead.
 */

interface Props {
  sequenceId: string
  cueIndex: number
  /** The language a new note is about, or null for the cue in general. */
  lang: string | null
  comments: ProjectComment[]
  onChange: (comments: ProjectComment[]) => void
  /** Whose notes carry a delete button — the server would refuse the rest anyway. */
  isMine: (c: ProjectComment) => boolean
  /** Sent with every request: the review token, when this is a client's view. */
  authHeaders?: Record<string, string>
  onClose: () => void
}

export default function CommentsPanel({
  sequenceId, cueIndex, lang, comments, onChange, isMine, authHeaders, onClose,
}: Props) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const thread = comments.filter(c => c.cue_index === cueIndex)
  const headers = { 'Content-Type': 'application/json', ...authHeaders }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function post() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/sequences/${sequenceId}/comments`, {
      method: 'POST',
      headers,
      // Which language it was written on, so "this reads oddly" is anchored to
      // a language rather than to the cue in general.
      body: JSON.stringify({ cueIndex, lang, body }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(json.error ?? 'Could not post that')
      return
    }
    onChange(json.comments as ProjectComment[])
    setDraft('')
  }

  async function toggleResolved(c: ProjectComment) {
    const res = await fetch(`/api/sequences/${sequenceId}/comments/${c.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ resolved: !c.resolved }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError('Could not update that comment')
      return
    }
    const updated = json.comment as ProjectComment | undefined
    onChange(comments.map(x => (x.id === c.id
      ? { ...x, resolved: !c.resolved, resolved_at: updated?.resolved_at ?? null }
      : x)))
  }

  async function remove(c: ProjectComment) {
    const res = await fetch(`/api/sequences/${sequenceId}/comments/${c.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    if (!res.ok) {
      setError('Could not delete that comment')
      return
    }
    onChange(comments.filter(x => x.id !== c.id))
  }

  return (
    <div
      className="overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Comments on subtitle ${cueIndex}`}
    >
      <div className="panel" style={{ '--panel-w': '420px', '--panel-h': '64vh' } as CSSProperties}>
        <div className="panel-head">
          <span className="panel-title">Comments on #{cueIndex}</span>
          <button className="panel-close" onClick={onClose} aria-label="Close comments">×</button>
        </div>

        <div className="panel-body">
          {thread.length === 0 && (
            <div className="muted" style={{ padding: '10px 0' }}>
              No comments on this subtitle yet.
            </div>
          )}
          {thread.map(c => (
            <div key={c.id} style={{
              padding: '7px 0', borderBottom: '1px solid var(--border)',
              opacity: c.resolved ? .55 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)' }}>
                  {c.author_name ?? 'Someone'}
                </span>
                {c.guest_id && (
                  <span className="muted" style={{ fontSize: 9 }}>client</span>
                )}
                {c.lang && (
                  <span style={{ fontSize: 9, padding: '0 5px', borderRadius: 3, background: 'var(--accent-dim)', color: '#8ba8ff' }}>
                    {c.lang}
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
                <button className="btn" style={{ marginLeft: 'auto' }}
                  onClick={() => void toggleResolved(c)}
                  title={c.resolved
                    ? `Resolved ${c.resolved_at ? new Date(c.resolved_at).toLocaleString() : ''} — reopen`
                    : 'Mark as resolved'}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {/* Only on your own, because only your own would be accepted —
                    offering the button to everyone is offering a 404. */}
                {isMine(c) && (
                  <button className="btn btn-danger" onClick={() => void remove(c)}
                    title="Delete this comment">
                    ✕
                  </button>
                )}
              </div>
              <div style={{
                fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                textDecoration: c.resolved ? 'line-through' : 'none',
              }}>
                {c.body}
              </div>
            </div>
          ))}
        </div>

        {error && <div className="err" style={{ padding: '0 13px 6px' }}>{error}</div>}

        <div className="panel-foot">
          <input
            className="field"
            style={{ flex: 1 }}
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void post() } }}
            placeholder={lang ? `Comment on the ${lang}…` : 'Write a comment…'}
          />
          <button className="btn btn-primary btn-lg" onClick={() => void post()}
            disabled={busy || !draft.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
