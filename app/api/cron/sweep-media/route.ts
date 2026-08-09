import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { deleteMediaByStorageKeys, orphanedStorageKeys } from '@/lib/db/media'
import { listOrganizationIds } from '@/lib/db/organizations'
import { deleteObject, r2Config } from '@/lib/storage/r2'

/**
 * Delete uploads nobody claimed.
 *
 * Two things leave objects behind. An upload can be abandoned between getting
 * its URL and being transcribed, and a deleted project cascades its media rows
 * away while the bytes stay in the bucket. Neither shows up anywhere: no screen
 * lists them, no error mentions them. They are a bill that grows quietly and,
 * once a customer asks to be erased, a promise we did not keep.
 *
 * Media only exists to be transcribed, and a transcription is minutes of work.
 * Anything still unattached after a day is over, whatever happened to it.
 */

export const maxDuration = 300

/**
 * Only the scheduler may run this.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set.
 * With no secret configured the answer is no — an endpoint that deletes things
 * must fail closed, and an unauthenticated deleter reachable from the internet
 * is worse than a sweeper that never runs.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization')
  if (!secret || !header) return false

  const given = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  }
  if (!r2Config()) {
    return NextResponse.json({ error: 'Object storage is not configured' }, { status: 503 })
  }

  let objects = 0
  let rows = 0
  let failed = 0

  // One organisation at a time: every media query stays scoped, so a bug here
  // can waste a sweep but cannot reach into another tenant's uploads.
  for (const orgId of await listOrganizationIds()) {
    const keys = await orphanedStorageKeys(orgId)
    if (keys.length === 0) continue

    const deleted: string[] = []
    for (const key of keys) {
      if (await deleteObject(key)) deleted.push(key)
      else failed++
    }

    // Rows are dropped only for keys whose bytes are actually gone. A key that
    // refused to delete keeps its row and is retried tomorrow; forgetting it
    // now would strand the object with nothing left pointing at it.
    objects += deleted.length
    rows += await deleteMediaByStorageKeys(orgId, deleted)
  }

  return NextResponse.json({ objects, rows, failed })
}
