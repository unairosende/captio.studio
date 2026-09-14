'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

    const res = await fetch(`/api/review/${token}/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(json.error ?? 'Could not continue')
      return
    }
    // The cookie is set; the server component reads it and shows the project.
    router.refresh()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} className="card" style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <div>
          <div style={{ fontSize: 16, color: 'var(--text)', fontWeight: 500 }}>{projectName}</div>
          <div className="muted" style={{ marginTop: 3 }}>
            {organizationName} has shared the subtitles of this project with you to review.
            Tell us who you are so your comments carry your name.
          </div>
        </div>
        <input
          className="field"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          autoFocus
          maxLength={80}
          required
        />
        <input
          className="field"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Your email"
          maxLength={254}
          required
        />
        <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          Your email is only used to let you know when somebody answers your comments.
        </div>
        {error && <div className="err">{error}</div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !name.trim() || !email.trim()}>
          {busy ? 'One moment…' : 'Open the review'}
        </button>
      </form>
    </div>
  )
}
