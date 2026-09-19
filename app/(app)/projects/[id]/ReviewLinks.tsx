'use client'

import { useState } from 'react'

import { api, send } from '@/lib/api'
import { REVIEW_LINK_EXPIRY_DAYS } from '@/lib/auth/expiry'
import type { ReviewLinkSummary } from '@/lib/db/review-links'

import s from './project.module.css'

/**
 * The links that let a client into this project.
 *
 * Each one is a URL the productora sends by whatever means they like — email,
 * WhatsApp, a delivery note. Whoever opens it says who they are and reviews
 * every sequence in the project. The section shows who has used each link
 * and when, and revokes one in a click; revoking keeps the row so the
 * comments that came through it still say who wrote them.
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

const day = (iso: string) => new Date(iso).toLocaleDateString('es-ES')

export default function ReviewLinks({ projectId, initial }: Props) {
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
    const r = await api<{ links?: ReviewLinkSummary[] }>(`/api/projects/${projectId}/review-links`)
    if (r.ok) setLinks(r.json.links ?? [])
  }

  async function create() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await send(`/api/projects/${projectId}/review-links`, { label, canEdit })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
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
    if (!confirm(`¿Revocar este enlace? ${link.guests.length ? 'Quien lo haya usado pierde el acceso. ' : ''}Sus comentarios se quedan.`)) return
    setError(null)
    const r = await api(`/api/projects/${projectId}/review-links/${link.id}`, { method: 'DELETE' })
    if (!r.ok) {
      setError(r.error)
      return
    }

    await refresh()
  }

  return (
    <>
      <div className={s.sectionHead}>
        <h2>Revisión del cliente</h2>
      </div>
      <div className="card">
        <div className={s.hint} style={{ marginBottom: 'var(--sp-3)' }}>
          Un enlace abre todas las secuencias de este proyecto a quien lo tenga. Caduca a los {REVIEW_LINK_EXPIRY_DAYS} días.
        </div>

        <div className={s.newLink}>
          <input
            className="field"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void create() } }}
            placeholder="¿Para quién? — p. ej. ACME · ronda 1"
            aria-label="Nombre del enlace"
            maxLength={80}
          />
          <label className={s.check}>
            <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)} />
            puede corregir el texto
          </label>
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy} aria-busy={busy || undefined}>Nuevo enlace</button>
        </div>

        {error && <div className="err" style={{ marginTop: 'var(--sp-2)' }}>{error}</div>}

        {urlToCopy && (
          <div>
            <div className={s.hint} style={{ marginTop: 'var(--sp-2)' }}>El navegador no deja llegar al portapapeles. Copia esto:</div>
            <div className={s.url}>{urlToCopy}</div>
          </div>
        )}

        {links.length === 0 && (
          <div className={s.hint} style={{ marginTop: 'var(--sp-3)' }}>Ningún enlace todavía. Crea uno y mándaselo al cliente.</div>
        )}

        {links.map(link => {
          const status = statusOf(link)
          return (
            <div key={link.id} className={s.access} data-off={status === 'active' ? undefined : ''}>
              <div className={s.accessBody}>
                <div className={s.accessLine}>
                  <span className={s.accessLabel}>{link.label || 'Enlace sin nombre'}</span>
                  <span className={s.accessNote}>{link.can_edit ? 'comentarios y correcciones' : 'solo comentarios'}</span>
                  <span className={s.accessNote} data-tone={status === 'active' ? 'ok' : undefined} suppressHydrationWarning>
                    {status === 'active' ? `caduca el ${day(link.expires_at)}` : status === 'revoked' ? 'revocado' : 'caducado'}
                  </span>
                </div>
                <div className={s.accessGuests} suppressHydrationWarning>
                  {link.guests.length === 0
                    ? 'Nadie lo ha abierto todavía'
                    : link.guests.map(g => `${g.name} (${g.email}) · ${day(g.last_seen_at)}`).join(' · ')}
                </div>
              </div>
              {status === 'active' && (
                <>
                  <button className="btn" onClick={() => void copy(link)} title="Copiar el enlace de revisión">
                    {copied === link.id ? 'Copiado' : 'Copiar enlace'}
                  </button>
                  <button className="btn btn-danger" onClick={() => void revoke(link)}>Revocar</button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
