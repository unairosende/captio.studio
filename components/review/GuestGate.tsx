'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { send } from '@/lib/api'

import s from './review.module.css'

/**
 * Who are you?
 *
 * The link is the credential; this is the name that goes on what the client
 * writes. Asked once — a cookie remembers — and asked plainly: no account, no
 * password, nothing to verify. The productora gave them the link; that is the
 * trust, and this is only the signature.
 */

interface Props {
  token: string
  projectName: string
  /** Who made the link, for the page to say whose subtitles these are. */
  organizationName: string
}

export default function GuestGate({ token, projectName, organizationName }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const r = await send(`/api/review/${token}/guest`, { name, email })
    setBusy(false)

    if (!r.ok) {
      setError(r.error)
      return
    }

    // The cookie is set; the server component reads it and shows the project.
    router.refresh()
  }

  return (
    <div className={`${s.page} ${s.center}`}>
      <form onSubmit={submit} className={`card ${s.gate}`}>
        <span className="brand">captio</span>
        <div>
          <h1>{projectName}</h1>
          <p>
            {organizationName} ha compartido contigo los subtítulos de este proyecto para que los
            revises. Di quién eres para que tus comentarios lleven tu nombre.
          </p>
        </div>
        <input
          className="field"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Tu nombre"
          aria-label="Tu nombre"
          autoFocus
          maxLength={80}
          required
        />
        <input
          className="field"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="tu@empresa.com"
          aria-label="Tu correo"
          maxLength={254}
          required
        />
        <p className="muted">Tu correo solo sirve para avisarte cuando alguien responda a tus comentarios.</p>
        {error && <p className="err" role="alert">{error}</p>}
        <button
          className="btn btn-primary btn-lg"
          type="submit"
          aria-busy={busy || undefined}
          disabled={!name.trim() || !email.trim()}
        >
          Abrir la revisión
        </button>
      </form>
    </div>
  )
}
