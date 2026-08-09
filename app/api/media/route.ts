import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createMedia } from '@/lib/db/media'
import { StorageNotConfiguredError, newStorageKey, presign } from '@/lib/storage/r2'

/**
 * Permission to upload one object.
 *
 * The browser sends the bytes straight to R2 with the URL this returns, so the
 * audio never enters a serverless function. That is not an optimisation: the
 * platform caps a request body at a few megabytes, which is minutes of audio,
 * and everything that does pass through a function is paid for twice — once
 * arriving and once leaving.
 *
 * The URL is what carries the authorisation, so it is deliberately narrow. It
 * is good for one method, one key, one size, for fifteen minutes.
 */

/** Generous for extracted audio, and far below anything worth paying to store. */
const MAX_BYTES = 1024 * 1024 * 1024

/** Long enough for a slow connection, short enough that a leaked URL is stale. */
const UPLOAD_WINDOW = 15 * 60

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const body = await req.json().catch(() => null)
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : ''
  const contentType = typeof body?.contentType === 'string' ? body.contentType : ''
  const bytes = Number(body?.bytes)

  if (!filename) {
    return NextResponse.json({ error: 'A filename is required' }, { status: 400 })
  }
  if (!/^(audio|video)\//.test(contentType)) {
    return NextResponse.json({ error: 'Only audio and video can be uploaded' }, { status: 415 })
  }
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
    return NextResponse.json(
      { error: `Size must be between 1 byte and ${MAX_BYTES} bytes` },
      { status: 413 },
    )
  }

  // The organisation comes from the session, never from the body, so one
  // customer cannot mint a URL inside another's prefix.
  const storageKey = newStorageKey(ctx.orgId, filename)

  let uploadUrl: string
  try {
    uploadUrl = presign('PUT', storageKey, {
      expiresIn: UPLOAD_WINDOW,
      // Signing the length is what makes MAX_BYTES a limit rather than a
      // suggestion: without it the URL accepts a file of any size and the
      // declared number is decoration.
      signedHeaders: { 'content-length': String(bytes) },
    })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  // Recorded with no project: the row is what lets the sweeper find the object
  // if the upload is abandoned or the transcription never happens. Writing it
  // only after a successful upload would leave exactly those bytes untracked.
  const media = await createMedia(ctx.orgId, {
    storageKey,
    filename,
    bytes,
    createdBy: ctx.userId,
  })

  return NextResponse.json({ mediaId: media.id, uploadUrl })
}
