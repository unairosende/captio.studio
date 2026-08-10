import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { logUsage } from '@/lib/db/billing'
import { getMedia } from '@/lib/db/media'
import { checkAllowance, paywallResponse } from '@/lib/entitlement'
import { StorageNotConfiguredError, presign } from '@/lib/storage/r2'
import { cuesFromWords, qcForMode, type TimedWord } from '@/lib/subtitles'

export const maxDuration = 300

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'

/**
 * Scribe v2. Checked against v1 on the same audio: v1 heard the product name
 * as "Capccio", v2 got it right. Proper nouns are the first thing a production
 * company checks in a transcript.
 */
const MODEL = 'scribe_v2'

/** Long enough for the provider to fetch a large object and start working. */
const READ_WINDOW = 15 * 60

/**
 * Transcribe an object that is already in the bucket.
 *
 * The caller names an upload rather than sending one, and the provider is given
 * a signed URL and fetches it itself, so the audio travels from R2 to
 * ElevenLabs without passing through this function.
 *
 * Scribe returns words rather than segments, which is the reason for choosing
 * it. A recogniser's own segments are chosen for transcription and routinely
 * run to a whole paragraph; per-word timings let the cue boundaries be decided
 * by subtitling rules instead, and with diarisation on, split whenever the
 * speaker changes. See lib/subtitles/cues.ts.
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

  const language = typeof body?.language === 'string' ? body.language : ''
  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null
  const outputMode = body?.outputMode === 'vertical' ? 'vertical' : 'horizontal'

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'Transcription is not configured' }, { status: 500 })
  }

  // Scoped by organisation, so an id belonging to somebody else is simply not
  // found. This lookup is the whole access check for the object behind it.
  const media = await getMedia(ctx.orgId, mediaId)
  if (!media) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  const allowance = await checkAllowance(ctx.orgId, 'transcribe')
  if (!allowance.allowed) return paywallResponse(allowance)

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
  form.append('cloud_storage_url', readUrl)
  form.append('model_id', MODEL)
  // The point of this provider: without it, two people talking share a cue.
  form.append('diarize', 'true')
  form.append('timestamps_granularity', 'word')
  if (language) form.append('language_code', language)

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: err?.detail?.message ?? err?.detail ?? `HTTP ${res.status}` },
      { status: res.status },
    )
  }

  const data = await res.json()

  // Scribe interleaves spacing and audio-event entries with the words; only
  // the words carry text worth showing.
  const words: TimedWord[] = (Array.isArray(data?.words) ? data.words : [])
    .filter((w: { type?: string }) => w?.type === 'word')
    .map((w: { text: string; start: number; end: number; speaker_id?: string }) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      speakerId: w.speaker_id ?? null,
    }))

  const segments = cuesFromWords(words, qcForMode(outputMode))

  // Billed by audio duration, which Scribe does not report. The last word ends
  // where the speech does, and silence at the tail is not worth charging for.
  await logUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    projectId,
    kind: 'transcribe',
    model: MODEL,
    unitsIn: Math.round(words.at(-1)?.end ?? 0),
  })

  return NextResponse.json({
    segments,
    language: data?.language_code ?? null,
    text: data?.text ?? '',
  })
}
