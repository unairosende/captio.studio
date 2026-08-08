import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { logUsage } from '@/lib/db/billing'

export const maxDuration = 300

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/audio/transcriptions',
  groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
} as const

type XcProvider = keyof typeof ENDPOINTS

/**
 * Transcribe an audio file.
 *
 * The upload is proxied straight through to the provider. That caps the file at
 * the platform's request-body limit — a few megabytes, which is minutes of
 * audio, not a feature. The fix is to upload to object storage from the browser
 * and send the provider a URL instead, which also removes this function from
 * the path entirely. Blocked on R2 being configured.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const formData = await req.formData()

  const requested = String(formData.get('xcProvider') ?? 'groq')
  const provider: XcProvider = requested === 'openai' ? 'openai' : 'groq'
  // The provider is ours to choose, not the caller's to pass on: forwarding an
  // unrecognised value would send the audio somewhere nobody vetted.
  formData.delete('xcProvider')

  const projectId = formData.get('projectId')
  formData.delete('projectId')

  const model = String(formData.get('model') ?? provider)

  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'Transcription provider not configured' }, { status: 500 })
  }

  const res = await fetch(ENDPOINTS[provider], {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
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
    projectId: typeof projectId === 'string' && projectId ? projectId : null,
    kind: 'transcribe',
    model,
    unitsIn: Math.round(Number(data?.duration ?? 0)),
  })

  return NextResponse.json(data)
}
