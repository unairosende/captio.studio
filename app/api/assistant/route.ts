import Anthropic from '@anthropic-ai/sdk'
import { NextResponse, type NextRequest } from 'next/server'

import { ASSISTANT_SYSTEM, TurnError, buildTurn, readTurn } from '@/lib/assistant/prompt'
import { REPLY_SCHEMA, ReplyFormatError, readReply } from '@/lib/assistant/reply'
import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { logUsage } from '@/lib/db/billing'
import { checkAllowance, paywallResponse } from '@/lib/entitlement'
import { costUsd } from '@/lib/pricing'

export const maxDuration = 120

/**
 * The model behind the chat on /projects/new.
 *
 * The assistant reads a request, a file's facts and later the whole source,
 * and has to notice what a careful subtitler would: the misheard brand in cue
 * 212, the "you" that is plural. That is judgement rather than throughput,
 * and the turns are few — a project is set up once — so it runs on the most
 * capable model rather than the cheapest. Translation itself stays where it
 * is (app/api/translate).
 */
const MODEL = 'claude-opus-5-5'

/**
 * How hard it thinks before answering. The model always reasons; this sets
 * how much. `medium` is its default, written out so a change is a decision.
 */
const EFFORT = 'medium'

/**
 * Room for the reasoning as well as the reply: on this model the thinking
 * counts against the same ceiling, and a ceiling sized for the JSON alone
 * truncates it mid-object.
 */
const MAX_TOKENS = 16_000

/**
 * Under the proxy in front of the deployment, which gives up at about a
 * hundred seconds and answers with its own HTML page (see the note on
 * GEMINI_TIMEOUT_MS in app/api/translate). No automatic retry for the same
 * reason: two slow attempts do not fit, and the chat offers its own.
 */
const TIMEOUT_MS = 80_000

/**
 * One turn of the project assistant.
 *
 * The browser sends the conversation and the facts it has; this composes the
 * prompt, asks the model, and answers with a reply that has been held to a
 * shape (lib/assistant/reply.ts). It never answers with free text, and it
 * creates nothing: the plan and the brief come back to the page, which shows
 * them to the person and acts only when they confirm, through the same routes
 * the editor uses — so the same allowance, tenancy and billing apply.
 *
 * Organisation members only, through the session. A review link must never
 * reach this (tests/tenancy/guest-surface.test.ts).
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Read per request, never at import: `next build` evaluates modules with no
  // secrets set (tests/build/no-secrets-at-import.test.ts).
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'El asistente no está configurado en este servidor.' }, { status: 503 })
  }

  let turn
  try {
    turn = readTurn(await req.json().catch(() => null))
  } catch (err) {
    if (err instanceof TurnError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  // Every turn costs a model call, and an organisation that has run out of
  // minutes could not use what the assistant sets up anyway.
  const allowance = await checkAllowance(ctx.orgId, 'translate')
  if (!allowance.allowed) return paywallResponse(allowance)

  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 })

  let response
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildTurn(turn) }],
      output_config: {
        effort: EFFORT,
        format: { type: 'json_schema', schema: REPLY_SCHEMA as unknown as Record<string, unknown> },
      },
      // A documentary about vaccines or an interview about security can trip
      // a safety classifier that has nothing to do with subtitles. The API
      // then reruns the turn on the model Anthropic recommends for that case
      // instead of returning a refusal.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
  } catch (err) {
    console.error('assistant call failed', err)
    const busy = err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)
    return NextResponse.json(
      {
        error: busy
          ? 'El asistente está saturado ahora mismo. Espera unos segundos y vuelve a intentarlo.'
          : 'No se pudo hablar con el asistente. Vuelve a intentarlo.',
      },
      { status: busy ? 503 : 502 },
    )
  }

  // Metered before anything is read from it: the tokens were spent whether or
  // not the reply turns out to be usable. Priced against the model that
  // answered, which after a fallback is not the one asked for.
  const usage = response.usage
  const unitsIn =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
  await logUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    kind: 'assistant',
    model: response.model,
    unitsIn,
    unitsOut: usage.output_tokens,
    costUsd: costUsd(response.model, { unitsIn, unitsOut: usage.output_tokens }),
  })

  if (response.stop_reason === 'refusal') {
    return NextResponse.json(
      { error: 'El asistente no ha podido trabajar con este material. Crea el proyecto desde el panel y tradúcelo en el editor.' },
      { status: 422 },
    )
  }
  if (response.stop_reason === 'max_tokens') {
    return NextResponse.json({ error: new ReplyFormatError('cortado').message }, { status: 502 })
  }

  // The reply is the last text block: reasoning comes back in blocks of its
  // own, and after a fallback the declined attempt's text may precede it.
  const last = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').at(-1)
  const raw = last?.text ?? ''

  try {
    const reply = readReply(JSON.parse(raw), turn.phase)
    // A plan needs material to be a plan of anything.
    if (!turn.file || turn.file.kind === 'other') reply.plan = null
    return NextResponse.json({ reply })
  } catch (err) {
    const message = err instanceof ReplyFormatError ? err.message : new ReplyFormatError('JSON ilegible').message
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
