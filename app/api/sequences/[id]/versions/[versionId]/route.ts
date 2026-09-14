import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { getVersion } from '@/lib/db/sequences'

/**
 * One version, data included — for the history to show what changed, and for
 * the team to put it back. Restoring is not a route of its own: the client
 * saves this data through the ordinary PATCH, which records the restore as one
 * more version rather than rewriting the past.
 */

interface Params {
  params: Promise<{ id: string; versionId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id, versionId } = await params
  const version = await getVersion(ctx.orgId, id, versionId)
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  return NextResponse.json({ version })
}
