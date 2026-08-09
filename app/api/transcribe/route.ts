import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { logUsage } from '@/lib/db/billing'
import { getMedia } from '@/lib/db/media'
import { StorageNotConfiguredError, presign } from '@/lib/storage/r2'

export const maxDuration = 300

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
} as const

type XcProvider = keyof typeof ENDPOINTS

/** Long enough for the provider to fetch a large object and start working. */
const READ_WINDOW = 15 * 60

/**
 * Transcribe an object that is already in the bucket.
 *
 * The caller names an upload rather than sending one. Groq accepts a URL, so
 * for the default provider the audio goes straight from R2 to Groq and this
 * function only ever handles a few hundred bytes of JSON. OpenAI takes the file
 * and nothing else, so there this function has to fetch the object and forward
 * it — which is the reason Groq is the default and not merely the fallback.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const body = await req.json().catch(() => null)

  const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : ''
  if (!mediaId) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  // The provider is ours to choose, not the caller's to pass on: forwarding an
  // unrecognised value would send the audio somewhere nobody vetted.
  const provider: XcProvider = body?.xcProvider === 'openai' ? 'openai' : 'groq'
  const model = typeof body?.model === 'string' && body.model ? body.model : provider
  const language = typeof body?.language === 'string' ? body.language : ''
  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null

  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'Transcription provider not configured' }, { status: 500 })
  }

  // Scoped by organisation, so an id belonging to somebody else is simply not
  // found. This lookup is the whole access check for the object behind it.
  const media = await getMedia(ctx.orgId, mediaId)
  if (!media) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  let readUrl: string
  try {
    readUrl = presign('GET', media.storage_key, { expiresIn: READ_WINDOW })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  const form = new FormData()
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  if (language) form.append('language', language)

  if (provider === 'groq') {
    // The bytes go from R2 to Groq without touching this function.
    form.append('url', readUrl)
  } else {
    const object = await fetch(readUrl)
    if (!object.ok) {
      return NextResponse.json({ error: 'Could not read the uploaded audio' }, { status: 502 })
    }
    form.append('file', await object.blob(), media.filename ?? 'audio.mp3')
  }

  const res = await fetch(ENDPOINTS[provider], {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: err?.error?.message ?? `HTTP ${res.status}` },
      { status: res.status },
    )
  }

  const data = await res.json()

  // Transcription is billed by audio duration, so that is what gets metered.
  // Only verbose_json carries it; without it the call still happened and is
  // recorded at zero rather than not at all.
  await logUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    projectId,
    kind: 'transcribe',
    model,
    unitsIn: Math.round(Number(data?.duration ?? 0)),
  })

  return NextResponse.json(data)
}
