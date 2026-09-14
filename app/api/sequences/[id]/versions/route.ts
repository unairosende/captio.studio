import { NextResponse, type NextRequest } from 'next/server'

import { requireActor } from '@/lib/auth/actor'
import { authErrorResponse } from '@/lib/auth/session'
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

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  let actor
  try {
    // Open to guests: the history is part of what a review shows. The sequence
    // is verified against the caller here, member or client alike.
    actor = await requireActor(req, id)
  } catch (err) {
    return authErrorResponse(err)
  }

  const versions = await listVersions(actor.orgId, id)
  return NextResponse.json({ versions })
}
