'use client'

import { useRouter } from 'next/navigation'

/** Who the page thinks you are, and the way to say it is not you. */
export default function GuestBadge({ token, name, email }: { token: string; name: string; email: string }) {
  const router = useRouter()

  async function forget() {
    await fetch(`/api/review/${token}/guest`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)' }}>
      {name} · {email}
      <button className="btn btn-quiet" onClick={() => void forget()}>Not you?</button>
    </span>
  )
}
