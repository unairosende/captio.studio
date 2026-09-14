import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { revokeLink } from '@/lib/db/review-links'

/**
 * Revoke a review link.
 *
 * DELETE in HTTP, revoke in the database: the row stays, marked, because the
 * comments that came through it keep their provenance and "who let this
 * person in, and when" is a question worth being able to answer later.
 */

interface Params {
  params: Promise<{ id: string; linkId: string }>
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id, linkId } = await params
  const gone = await revokeLink(ctx.orgId, id, linkId)
  if (!gone) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
