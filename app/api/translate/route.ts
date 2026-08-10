import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import {
  TranslationFormatError,
  buildBackTranslationPrompt,
  buildShortenPrompt,
  buildTranslationPrompt,
  parseTranslationResponse,
  type GlossaryEntry,
} from '@/lib/ai/prompt'
import { logUsage } from '@/lib/db/billing'
import { checkAllowance, paywallResponse } from '@/lib/entitlement'
import { MAX_CHARS_HORIZONTAL, MAX_CHARS_VERTICAL } from '@/lib/subtitles'

export const maxDuration = 300

/**
 * Translation runs on Gemini, and the customer does not choose.
 *
 * Five providers behind a dropdown was a hobbyist's control panel: a
 * production company wants good subtitles, not a menu containing
 * `qwen-qwq-32b`. Each one was also a row in the subprocessor table, a set of
 * terms to read before anybody could say whether unreleased dialogue trains
 * somebody's model, and a key to rotate — real cost, for a choice nobody
 * wanted.
 *
 * Groq stays as a fallback that never appears in the interface. One provider
 * would mean one outage takes the product down, and rate limits are routine; a
 * customer who never picked Gemini should not have to hear that it is busy.
 */
const PRIMARY_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'llama-3.3-70b-versatile'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * Gemini 2.5 spends output budget on its thinking pass before it writes a
 * single character of the answer. At 4096 the reply gets truncated mid-JSON on
 * an ordinary batch, and the failure reads as a malformed response rather than
 * a budget that was too small.
 */
const MAX_OUTPUT_TOKENS = 16_000

/** How many cues one request may carry. Enough for a batch, far short of a film. */
const MAX_CUES = 60
/** Nobody writes a subtitle this long. A larger value is somebody probing. */
const MAX_CUE_CHARS = 2_000

interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
}

async function callGemini(prompt: string): Promise<ProviderResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Gemini is not configured')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(PRIMARY_MODEL)}:generateContent?key=${key}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return {
    text: data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    tokensIn: data?.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data?.usageMetadata?.candidatesTokenCount ?? 0,
  }
}

async function callGroq(prompt: string): Promise<ProviderResult> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('Groq is not configured')

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      temperature: 0.3,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    tokensIn: data?.usage?.prompt_tokens ?? 0,
    tokensOut: data?.usage?.completion_tokens ?? 0,
  }
}

/**
 * Gemini, then Groq once if Gemini would not answer.
 *
 * Bounded to a single retry: a prompt Gemini rejects will usually be rejected
 * by anything, and a loop of fallbacks turns one bad request into a bill.
 */
async function translate(prompt: string): Promise<ProviderResult & { model: string }> {
  try {
    return { ...(await callGemini(prompt)), model: PRIMARY_MODEL }
  } catch (primary) {
    if (!process.env.GROQ_API_KEY) throw primary
    console.warn('gemini failed, falling back to groq:', primary)
    return { ...(await callGroq(prompt)), model: FALLBACK_MODEL }
  }
}

/** The three things the editor asks a model for. There is no fourth. */
type Task = 'translate' | 'backTranslate' | 'shorten'

interface Body {
  task?: Task
  cues?: unknown
  /** Original source texts, so `shorten` compresses without inventing. */
  sourceTexts?: string[]
  targetLang?: string
  sourceLang?: string
  outputMode?: 'horizontal' | 'vertical'
  glossary?: GlossaryEntry[]
  extraInstructions?: string
  previousContext?: string[]
  projectId?: string
}

/**
 * Translate a batch of cues.
 *
 * The caller sends cues and settings. It does NOT send a prompt: this route
 * composes it. Accepting prose from the client turned a subtitling
 * subscription into an unmetered general-purpose model that anyone with an
 * account could point at anything.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const body = (await req.json()) as Body

  if (!body.targetLang) {
    return NextResponse.json({ error: 'targetLang is required' }, { status: 400 })
  }

  if (!Array.isArray(body.cues) || !body.cues.every(c => typeof c === 'string')) {
    return NextResponse.json({ error: 'cues must be an array of strings' }, { status: 400 })
  }
  const cues = body.cues as string[]
  if (!cues.length) return NextResponse.json({ error: 'cues is empty' }, { status: 400 })
  if (cues.length > MAX_CUES) {
    return NextResponse.json({ error: `at most ${MAX_CUES} cues per request` }, { status: 400 })
  }
  if (cues.some(c => c.length > MAX_CUE_CHARS)) {
    return NextResponse.json({ error: 'a cue is implausibly long' }, { status: 400 })
  }

  const maxChars = body.outputMode === 'vertical' ? MAX_CHARS_VERTICAL : MAX_CHARS_HORIZONTAL
  const task: Task = body.task ?? 'translate'

  let prompt: string
  if (task === 'backTranslate') {
    prompt = buildBackTranslationPrompt({
      cues,
      fromLang: body.targetLang,
      toLang: body.sourceLang ?? 'Auto-detect',
    })
  } else if (task === 'shorten') {
    prompt = buildShortenPrompt({
      cues,
      // Falls back to the translations themselves when no source is supplied,
      // which is worse but still bounded — never an unbounded free-text field.
      sourceTexts: Array.isArray(body.sourceTexts) ? body.sourceTexts.slice(0, cues.length) : cues,
      lang: body.targetLang,
      maxChars,
    })
  } else if (task === 'translate') {
    prompt = buildTranslationPrompt({
      cues,
      targetLang: body.targetLang,
      sourceLang: body.sourceLang,
      maxChars,
      glossary: body.glossary,
      extraInstructions: body.extraInstructions,
      previousContext: body.previousContext,
    })
  } else {
    return NextResponse.json({ error: 'unknown task' }, { status: 400 })
  }

  // Last thing before spending money, and after every validation: a malformed
  // request should hear why it is malformed, not that the trial is over.
  const allowance = await checkAllowance(ctx.orgId, 'translate')
  if (!allowance.allowed) return paywallResponse(allowance)

  try {
    const { text, tokensIn, tokensOut, model } = await translate(prompt)

    // Metered before parsing: the tokens were spent whether or not the reply
    // was usable, and a bill that only counts successes under-reports cost.
    await logUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      projectId: body.projectId ?? null,
      kind: 'translate',
      model,
      unitsIn: tokensIn,
      unitsOut: tokensOut,
      // What the trial is denominated in. Counted here rather than from the
      // reply, so a batch that came back unusable still spends its allowance —
      // the provider charged for it either way.
      cues: cues.length,
    })

    return NextResponse.json({ translations: parseTranslationResponse(text, cues.length) })
  } catch (err) {
    if (err instanceof TranslationFormatError) {
      // The caller can retry this one; it is the model misbehaving, not the request.
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
