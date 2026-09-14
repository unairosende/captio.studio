import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { getMedia } from '@/lib/db/media'
import { StorageNotConfiguredError, presign } from '@/lib/storage/r2'

/**
 * Permission to read one object back: the waveform's own GET, next to the
 * upload's POST in ../route.ts.
 *
 * The editor already holds decoded audio for anything loaded through the file
 * picker — that never touched R2 to begin with. This is for the other case: a
 * sequence opened cold, whose recording is only in the bucket. The browser
 * still does its own fetch and decodeAudioData, so this hands back a URL to
 * read with, not the bytes themselves.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** Long enough for a slow connection to pull a feature-length file, short enough that a leaked URL is stale. */
const DOWNLOAD_WINDOW = 5 * 60

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Scoped by organisation, so an id belonging to somebody else is simply not
  // found — the same rule every table in lib/db follows, and the whole access
  // check for the object behind it.
  const media = await getMedia(ctx.orgId, (await params).id)
  if (!media) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  try {
    const url = presign('GET', media.storage_key, { expiresIn: DOWNLOAD_WINDOW })
    return NextResponse.json({ url, filename: media.filename })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
