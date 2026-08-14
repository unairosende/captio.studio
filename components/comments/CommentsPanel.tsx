'use client'

import { useEffect, useRef, useState } from 'react'

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

  const btn = {
    padding: '2px 7px', borderRadius: 4, fontSize: 11, lineHeight: 1.5, cursor: 'pointer',
    border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text3)',
  } as const

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
        background: 'rgba(0,0,0,.5)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Comments on subtitle ${cueIndex}`}
    >
      <div style={{
        width: 420, maxHeight: '64vh', display: 'flex', flexDirection: 'column',
        borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--bg1)',
        boxShadow: '0 18px 50px rgba(0,0,0,.45)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
            Comments on #{cueIndex}
          </span>
          <button onClick={onClose} aria-label="Close comments"
            style={{ ...btn, marginLeft: 'auto', border: 'none', background: 'none', fontSize: 15 }}>
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '9px 13px' }}>
          {thread.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '10px 0' }}>
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
                <button onClick={() => void toggleResolved(c)} style={{ ...btn, marginLeft: 'auto' }}
                  title={c.resolved ? 'Reopen this comment' : 'Mark as resolved'}>
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {/* Only on your own, because only your own would be accepted —
                    offering the button to everyone is offering a 404. */}
                {c.author_id === userId && (
                  <button onClick={() => void remove(c)} style={{ ...btn, color: 'var(--red)' }}
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

        {error && (
          <div style={{ padding: '0 13px 6px', fontSize: 11, color: 'var(--red)' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 7, padding: '9px 13px', borderTop: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void post() } }}
            placeholder="Write a comment…"
            style={{
              flex: 1, padding: '5px 8px', borderRadius: 5, fontSize: 12,
              border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
            }}
          />
          <button onClick={() => void post()} disabled={busy || !draft.trim()}
            style={{ ...btn, padding: '5px 11px', color: 'var(--text)', borderColor: 'var(--accent)' }}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
