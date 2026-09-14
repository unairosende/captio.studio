'use client'

import { useState } from 'react'

import { REVIEW_LINK_EXPIRY_DAYS } from '@/lib/auth/expiry'
import type { ReviewLinkSummary } from '@/lib/db/review-links'

/**
 * The links that let a client into this project.
 *
 * Each one is a URL the productora sends by whatever means they like — email,
 * WhatsApp, a delivery note. Whoever opens it says who they are and reviews
 * every sequence in the project. The panel shows who has used each link and
 * when, and revokes one in a click; revoking keeps the row so the comments
 * that came through it still say who wrote them.
 */

interface Props {
  projectId: string
  initial: ReviewLinkSummary[]
}

type Status = 'active' | 'revoked' | 'expired'

function statusOf(link: ReviewLinkSummary): Status {
  if (link.revoked_at) return 'revoked'
  if (new Date(link.expires_at).getTime() < Date.now()) return 'expired'
  return 'active'
}

export default function ReviewLinksPanel({ projectId, initial }: Props) {
  const [links, setLinks] = useState(initial)
  const [label, setLabel] = useState('')
  const [canEdit, setCanEdit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which link's URL was last copied, so the button can say so. */
  const [copied, setCopied] = useState<string | null>(null)
  /** Shown when the clipboard is refused: the URL itself, to copy by hand. */
  const [urlToCopy, setUrlToCopy] = useState<string | null>(null)

  const urlOf = (link: ReviewLinkSummary) => `${window.location.origin}/r/${link.token}`

  async function refresh() {
    const res = await fetch(`/api/projects/${projectId}/review-links`)
    if (res.ok) setLinks((await res.json()).links ?? [])
  }

  async function create() {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/review-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, canEdit }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(json.error ?? 'Could not create the link')
      return
    }
    setLabel('')
    await refresh()
  }

  async function copy(link: ReviewLinkSummary) {
    setError(null)
    setUrlToCopy(null)
    try {
      await navigator.clipboard.writeText(urlOf(link))
      setCopied(link.id)
    } catch {
      // The clipboard can be refused; the URL on screen is the same answer by
      // the one route left. Same as the team panel's invitation link.
      setUrlToCopy(urlOf(link))
    }
  }

  async function revoke(link: ReviewLinkSummary) {
    if (!confirm(`Revoke this link? ${link.guests.length ? 'The people who used it will lose access. ' : ''}Their comments stay.`)) return
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/review-links/${link.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError('Could not revoke that link')
      return
    }
    await refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '28px 0 6px' }}>
        <span className="caps">Client review</span>
        <span className="muted">
          A link opens every sequence of this project to whoever holds it. Expires in {REVIEW_LINK_EXPIRY_DAYS} days.
        </span>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 180 }}
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void create() } }}
            placeholder="Who is it for? — e.g. ACME · round 1"
            aria-label="Link label"
            maxLength={80}
          />
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)} />
            can correct the text
          </label>
          <button className="btn btn-primary btn-lg" onClick={() => void create()} disabled={busy}>
            {busy ? 'Creating…' : 'New link'}
          </button>
        </div>

        {error && <div className="err">{error}</div>}

        {urlToCopy && (
          <div>
            <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginBottom: 3 }}>
              Your browser would not let the page reach the clipboard. Copy this:
            </div>
            <div style={{
              userSelect: 'all', wordBreak: 'break-all',
              fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--text2)',
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)', padding: '5px 7px',
            }}>
              {urlToCopy}
            </div>
          </div>
        )}

        {links.length === 0 && (
          <div className="muted">No links yet. Make one and send it to the client.</div>
        )}

        {links.map(link => {
          const status = statusOf(link)
          return (
            <div key={link.id} className="row" style={{ alignItems: 'flex-start', opacity: status === 'active' ? 1 : .6 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
                    {link.label || 'Untitled link'}
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                    {link.can_edit ? 'comments and corrections' : 'comments only'}
                  </span>
                  <span className={status === 'active' ? 'ok' : 'muted'} style={{ fontSize: 'var(--fs-xs)' }}>
                    {status === 'active'
                      ? `expires ${new Date(link.expires_at).toLocaleDateString()}`
                      : status === 'revoked' ? 'revoked' : 'expired'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 3 }}>
                  {link.guests.length === 0
                    ? 'Nobody has opened it yet'
                    : link.guests.map(g => `${g.name} (${g.email}) · ${new Date(g.last_seen_at).toLocaleDateString()}`).join(' · ')}
                </div>
              </div>
              {status === 'active' && (
                <>
                  <button className="btn" onClick={() => void copy(link)} title="Copy the review link">
                    {copied === link.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button className="btn btn-danger" onClick={() => void revoke(link)}>Revoke</button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
