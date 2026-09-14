import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createLink, listLinks } from '@/lib/db/review-links'
import { UnknownProjectError } from '@/lib/db/sequences'

/**
 * The review links of one project: list them, make one.
 *
 * Any member may share a project with a client — it is the everyday act of
 * delivering work, not an administrative one. The link is created inside a
 * scoped INSERT, so a project id from another organisation is not found rather
 * than shared.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** A name for the link, not a description of it. */
const MAX_LABEL = 80

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const links = await listLinks(ctx.orgId, (await params).id)
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const body = await req.json().catch(() => null)

  try {
    const link = await createLink(ctx.orgId, {
      projectId: id,
      label: typeof body?.label === 'string' ? body.label.trim().slice(0, MAX_LABEL) : null,
      canEdit: typeof body?.canEdit === 'boolean' ? body.canEdit : true,
      createdBy: ctx.userId,
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (err) {
    if (err instanceof UnknownProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
