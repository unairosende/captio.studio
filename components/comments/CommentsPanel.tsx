'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { useSubtitleStore } from '@/store/useSubtitleStore'
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
 */

interface Props {
  projectId: string
  cueIndex: number
  userId: string
  onClose: () => void
}

export default function CommentsPanel({ projectId, cueIndex, userId, onClose }: Props) {
  const { comments, setComments, activeTab } = useSubtitleStore()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const thread = comments.filter(c => c.cue_index === cueIndex)

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

    const res = await fetch(`/api/projects/${projectId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cueIndex,
        // Which tab it was written on, so "this reads oddly" is anchored to a
        // language rather than to the cue in general.
        lang: activeTab === 'source' ? null : activeTab,
        body,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(json.error ?? 'Could not post that')
      return
    }
    setComments(json.comments as ProjectComment[])
    setDraft('')
  }

  async function toggleResolved(c: ProjectComment) {
    const res = await fetch(`/api/projects/${projectId}/comments/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !c.resolved }),
    })
    if (!res.ok) {
      setError('Could not update that comment')
      return
    }
    setComments(comments.map(x => (x.id === c.id ? { ...x, resolved: !c.resolved } : x)))
  }

  async function remove(c: ProjectComment) {
    const res = await fetch(`/api/projects/${projectId}/comments/${c.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError('Could not delete that comment')
      return
    }
    setComments(comments.filter(x => x.id !== c.id))
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
                  title={c.resolved ? 'Reopen this comment' : 'Mark as resolved'}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {/* Only on your own, because only your own would be accepted —
                    offering the button to everyone is offering a 404. */}
                {c.author_id === userId && (
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
            placeholder="Write a comment…"
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
