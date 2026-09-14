import { NextResponse, type NextRequest } from 'next/server'

import { guestCookie } from '@/lib/auth/actor'
import { REVIEW_LINK_EXPIRY_SECONDS } from '@/lib/auth/expiry'
import { getLinkByToken, registerGuest } from '@/lib/db/review-links'

/**
 * A client says who they are.
 *
 * The link is the credential; this is the name on it. Nothing here signs
 * anybody in — the cookie names a guest row that only means something together
 * with the link's own token, which every later request must still carry.
 *
 * Reachable without a session by design (see proxy.ts): the person on the
 * other end has never had one.
 */

interface Params {
  params: Promise<{ token: string }>
}

/** Long enough for a real name; short enough not to be a paragraph pasted by mistake. */
const MAX_NAME = 80
/** RFC 5321's ceiling for an address. */
const MAX_EMAIL = 254

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function POST(req: NextRequest, { params }: Params) {
  const link = await getLinkByToken((await params).token)
  if (!link) return NextResponse.json({ error: 'This link is no longer active' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!name || name.length > MAX_NAME) {
    return NextResponse.json({ error: 'Tell us your name' }, { status: 400 })
  }
  if (!looksLikeEmail(email) || email.length > MAX_EMAIL) {
    return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 })
  }

  const guest = await registerGuest(link.org_id, link.id, { name, email })

  const res = NextResponse.json({ guest: { id: guest.id, name: guest.name, email: guest.email } })
  res.cookies.set(guestCookie(link.id), guest.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // The cookie cannot outlive the link it belongs to.
    maxAge: REVIEW_LINK_EXPIRY_SECONDS,
  })
  return res
}

/** "That is not me": forget the guest, keep the link. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const link = await getLinkByToken((await params).token)
  if (!link) return NextResponse.json({ error: 'This link is no longer active' }, { status: 404 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(guestCookie(link.id), '', { path: '/', maxAge: 0 })
  return res
}
