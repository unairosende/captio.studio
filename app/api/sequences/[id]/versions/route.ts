import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { listVersions } from '@/lib/db/sequences'

/**
 * The history of one sequence: who saved, when, and what they called it.
 *
 * Never the data. A feature-length track is megabytes of JSON per version, and
 * the list is read far more often than any one entry is opened — the entry
 * route next door hands over the data for the version somebody actually picks.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Scoped by organisation and sequence, so a sequence that is not the caller's
  // simply has no history — the same answer as one that never existed.
  const versions = await listVersions(ctx.orgId, (await params).id)
  return NextResponse.json({ versions })
}
