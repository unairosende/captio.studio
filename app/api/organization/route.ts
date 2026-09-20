import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { getOrganization } from '@/lib/db/organizations'
import { eraseOrganization } from '@/lib/erasure'

/**
 * Delete the caller's organisation, and everything in it, now.
 *
 * The erasure obligation with a face: a customer asking to be forgotten, doing
 * it themselves rather than emailing to ask. It cancels the subscription, clears
 * the bucket and drops every row the organisation owns (see lib/erasure.ts).
 *
 * Two guards, because this cannot be undone:
 *
 *  - Owner only. Deleting the organisation ends everyone else's access and the
 *    billing with it; an admin manages the team, an owner *is* the account. This
 *    is stricter than the billing routes, which allow admins.
 *  - The name has to be typed back. The dialog asks for it and this checks it
 *    again on the server, so a stray fetch — or a misclick that never saw the
 *    dialog — cannot delete an organisation by reaching the URL. It is compared
 *    against the name in the database, never one supplied alongside it.
 *
 * maxDuration is raised because clearing a large bucket is one DELETE per
 * object, and an organisation with a back catalogue has a lot of them.
 */
export const maxDuration = 300

export async function DELETE(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  if (ctx.role !== 'owner') {
    return NextResponse.json(
      { error: 'Solo el propietario puede eliminar la organización' },
      { status: 403 },
    )
  }

  const org = await getOrganization(ctx.orgId)
  if (!org) {
    return NextResponse.json({ error: 'La organización ya no existe' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const confirm = typeof body?.confirm === 'string' ? body.confirm.trim() : ''
  if (confirm !== org.name) {
    return NextResponse.json(
      { error: 'Escribe el nombre de la organización para confirmar' },
      { status: 400 },
    )
  }

  try {
    const summary = await eraseOrganization(ctx.orgId)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    // A stubborn object left the organisation intact on purpose (see
    // lib/erasure.ts): it is retriable, so say so rather than return a 500 that
    // reads as "already broken".
    console.error('organisation erasure', err)
    return NextResponse.json(
      { error: 'No se pudo completar el borrado. Inténtalo de nuevo.' },
      { status: 502 },
    )
  }
}
