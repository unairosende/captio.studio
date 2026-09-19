'use client'

import { useRouter } from 'next/navigation'

import { api } from '@/lib/api'

import s from './review.module.css'

/** Who the page thinks you are, and the way to say it is not you. */
export default function GuestBadge({ token, name, email }: { token: string; name: string; email: string }) {
  const router = useRouter()

  async function forget() {
    await api(`/api/review/${token}/guest`, { method: 'DELETE' })
    router.refresh()

  }

  return (
    <span className={s.guest}>
      <span>{name}</span>
      <span className="muted">{email}</span>
      <button className="btn btn-quiet" onClick={() => void forget()}>¿No eres tú?</button>
    </span>
  )
}
