'use client'

import { useEffect, useRef, useState } from 'react'

import Dialog from '@/components/Dialog'
import { api, send } from '@/lib/api'
import { shortLang } from '@/lib/lang'
import type { ProjectComment } from '@/types/comment'

import s from './comments.module.css'

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

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function post() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)

    // Which language it was written on, so "this reads oddly" is anchored to
    // a language rather than to the cue in general.
    const r = await send<{ comments: ProjectComment[] }>(`/api/sequences/${sequenceId}/comments`, { cueIndex, lang, body }, 'POST', authHeaders)
    setBusy(false)

    if (!r.ok) {
      setError(r.error)
      return
    }
    onChange(r.json.comments)
    setDraft('')
  }

  async function toggleResolved(c: ProjectComment) {
    const r = await send<{ comment?: ProjectComment }>(`/api/sequences/${sequenceId}/comments/${c.id}`, { resolved: !c.resolved }, 'PATCH', authHeaders)
    if (!r.ok) {
      setError(r.error)
      return
    }
    const updated = r.json.comment
    onChange(comments.map(x => (x.id === c.id
      ? { ...x, resolved: !c.resolved, resolved_at: updated?.resolved_at ?? null }
      : x)))
  }

  async function remove(c: ProjectComment) {
    const r = await api(`/api/sequences/${sequenceId}/comments/${c.id}`, { method: 'DELETE', headers: authHeaders })
    if (!r.ok) {
      setError(r.error)
      return
    }

    onChange(comments.filter(x => x.id !== c.id))
  }

  return (
    <Dialog label={`Comentarios del cue ${cueIndex}`} width="420px" height="64vh" onClose={onClose}>
        <div className="panel-head">
          <span className="panel-title">Comentarios del #{cueIndex}</span>
          <button className="btn btn-quiet btn-icon panel-close" onClick={onClose} aria-label="Cerrar los comentarios">×</button>
        </div>

        <div className="panel-body">
          {thread.length === 0 && (
            <p className={`muted ${s.none}`}>Todavía no hay comentarios en este cue.</p>
          )}
          {thread.map(c => (
            <div key={c.id} className={s.comment} data-resolved={c.resolved || undefined}>
              <div className={s.meta}>
                <span className={s.author}>{c.author_name ?? 'Alguien'}</span>
                {c.guest_id && <span>cliente</span>}
                {c.lang && <span className="badge">{shortLang(c.lang)}</span>}
                <span>
                  {new Date(c.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button className={`btn ${s.first}`}
                  onClick={() => void toggleResolved(c)}
                  title={c.resolved
                    ? `Resuelto ${c.resolved_at ? new Date(c.resolved_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} — reabrir`
                    : 'Marcar como resuelto'}>
                  {c.resolved ? 'Reabrir' : 'Resolver'}
                </button>
                {/* Only on your own, because only your own would be accepted —
                    offering the button to everyone is offering a 404. */}
                {isMine(c) && (
                  <button className="btn btn-danger" onClick={() => void remove(c)}
                    title="Borrar este comentario">
                    ✕
                  </button>
                )}
              </div>
              <p className={s.body}>{c.body}</p>
            </div>
          ))}
        </div>

        {error && <p className={`err ${s.error}`}>{error}</p>}

        <div className="panel-foot">
          <input
            className={`field ${s.draft}`}
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void post() } }}
            placeholder={lang ? `Comenta sobre el ${shortLang(lang)}…` : 'Escribe un comentario…'}
          />
          <button className="btn btn-primary btn-lg" onClick={() => void post()}
            disabled={busy || !draft.trim()}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
    </Dialog>
  )
}
