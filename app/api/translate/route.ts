import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import {
  TranslationFormatError,
  buildBackTranslationPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildShortenPrompt,
  buildTranslationPrompt,
  parseReviewResponse,
  parseTranslationResponse,
  type GlossaryEntry,
  type ReviewNote,
} from '@/lib/ai/prompt'
import { askInHalves } from '@/lib/ai/halves'
import { billSequence, logUsage } from '@/lib/db/billing'
import { checkAllowance, paywallResponse } from '@/lib/entitlement'
import { costUsd } from '@/lib/pricing'
import { getMedia } from '@/lib/db/media'
import { getSequence } from '@/lib/db/sequences'
import { MAX_CHARS_HORIZONTAL, MAX_CHARS_VERTICAL, materialSeconds, reflowText } from '@/lib/subtitles'

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
/**
 * Pinned, and checked against the live API rather than assumed.
 *
 * `gemini-2.5-flash` was here and answers 404 for a key created recently —
 * "no longer available to new users". With a fallback in place that would not
 * have failed loudly: Groq would have quietly served every translation, so the
 * product would have looked fine while running on a provider the subprocessor
 * list does not name as the primary one.
 *
 * `models.list` is not evidence — it still advertises 2.5-flash. Only a real
 * generateContent call tells the truth.
 */
const PRIMARY_MODEL = 'gemini-3.5-flash-lite'

/**
 * The fallback, and it needs the same check the primary got.
 *
 * `llama-3.3-70b-versatile` was here and answers 404: Groq retired every Llama
 * chat model, leaving only the prompt-guard classifiers under that name. The
 * fallback had therefore been dead for as long as it had been unused — which is
 * the failure mode of a fallback nobody exercises, and the reason this one is
 * now tested against the live API rather than assumed.
 */
const FALLBACK_MODEL = 'openai/gpt-oss-120b'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * How long a provider gets before we stop waiting for it.
 *
 * There is a proxy in front of this deployment that gives up at around a
 * hundred seconds and answers with its own HTML error page. Whatever happens
 * after that point cannot reach the caller, so a call left unbounded does not
 * buy patience — it buys a gateway error in place of a JSON one, a client that
 * fails parsing `<!DOCTYPE`, and a fallback that never gets its turn.
 *
 * Sixty seconds because Gemini's latency on a real batch is not a number, it is
 * a range: the same prompt measured 14s, 53s and 87s within one afternoon, with
 * intermittent 503s in between, and the spread is thinking tokens rather than
 * network. Cutting shorter would send ordinary batches to the fallback and
 * quietly change which provider does the work; cutting longer would not fit
 * under the proxy with the fallback's turn still to come.
 */
const GEMINI_TIMEOUT_MS = 60_000

/**
 * The fallback answers in under a second when it answers at all, so its budget
 * only has to cover a bad day rather than a slow one — and what is left of the
 * proxy's patience has to cover it.
 */
const GROQ_TIMEOUT_MS = 20_000

/**
 * Gemini spends output budget on its thinking pass before writing a single
 * character of the answer. At 4096 the reply gets truncated mid-JSON on an
 * ordinary batch, and the failure reads as a malformed response rather than as
 * a budget that was too small.
 */
const MAX_OUTPUT_TOKENS = 16_000

/**
 * Groq's ceiling is the account's, not the model's.
 *
 * On the on-demand tier the whole request — prompt plus reply — is measured
 * against 8,000 tokens per minute, and asking for 16,000 is refused with a 413
 * before a single token is generated. Half the budget for the reply leaves the
 * other half for a full batch of cues.
 *
 * Raise this the day the Groq account moves off the free tier, not before: the
 * number that matters is on the billing page, not in the model card.
 */
const GROQ_MAX_OUTPUT_TOKENS = 4_000

/** How many cues one request may carry. Enough for a batch, far short of a film. */
const MAX_CUES = 60
/** Nobody writes a subtitle this long. A larger value is somebody probing. */
const MAX_CUE_CHARS = 2_000

/**
 * How many model calls one request may make, retries and halves included.
 *
 * A batch the model keeps re-segmenting is split in two and each half asked
 * again (see `askInHalves`), and splitting has to stop somewhere or one bad
 * request becomes a bill. Sixteen is what it takes to isolate a single merged
 * pair at the worst position in a batch of thirty — two tries on the whole,
 * then one on each half down to a batch of one — with a little left over. A
 * batch that needs more than that is not unlucky, it is broken, and the caller
 * hears which cue broke it.
 */
const CALL_BUDGET = 16

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
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
      max_tokens: GROQ_MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
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

/**
 * What the editor asks a model for. Every one of them answers with exactly one
 * string per input cue — that shared contract is what `parseTranslationResponse`
 * enforces, and what stops any of them becoming a way to get arbitrary text
 * back out of a subtitling subscription.
 */
type Task = 'translate' | 'backTranslate' | 'shorten' | 'revise' | 'review'

interface Body {
  task?: Task
  cues?: unknown
  /** Original source texts, so `shorten` and `revise` work without inventing. */
  sourceTexts?: string[]
  /** What to change. `revise` only — the reviewer's own words. */
  instructions?: string
  /**
   * The cue numbers behind this batch.
   *
   * Required by every task. `revise` needs them so a correction naming a cue
   * can find it, and `review` so a note can say which cue it is about; the
   * rest need them as the anchor each subtitle travels under, so that a reply
   * short by one can say which one. None of them defaults to positions:
   * numbering a batch by its own positions is right for the first batch and
   * wrong for every one after it, and the damage is silent.
   */
  cueNumbers?: number[]
  targetLang?: string
  sourceLang?: string
  outputMode?: 'horizontal' | 'vertical'
  glossary?: GlossaryEntry[]
  extraInstructions?: string
  previousContext?: string[]
  sequenceId?: string
  /** The upload this work came from, when it was transcribed rather than imported. */
  mediaId?: string
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
  const targetLang = body.targetLang

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

  // Demanded rather than defaulted: see `Body.cueNumbers`.
  if (
    !Array.isArray(body.cueNumbers) ||
    body.cueNumbers.length !== cues.length ||
    !body.cueNumbers.every(n => typeof n === 'number')
  ) {
    return NextResponse.json({ error: 'cueNumbers must be one number per cue' }, { status: 400 })
  }
  const cueNumbers = body.cueNumbers

  // Falls back to the translations themselves when no source is supplied,
  // which is worse but still bounded — never an unbounded free-text field.
  const sourceTexts = Array.isArray(body.sourceTexts) ? body.sourceTexts.slice(0, cues.length) : cues

  const maxChars = body.outputMode === 'vertical' ? MAX_CHARS_VERTICAL : MAX_CHARS_HORIZONTAL
  const task: Task = body.task ?? 'translate'

  /**
   * What the model is shown: the whole batch first, and halves of it when the
   * count keeps coming back wrong — so the prompt is a function of the slice,
   * not a string built once.
   */
  interface Slice {
    cues: string[]
    numbers: number[]
    sourceTexts: string[]
  }
  const slice = (from: number, to: number): Slice => ({
    cues: cues.slice(from, to),
    numbers: cueNumbers.slice(from, to),
    sourceTexts: sourceTexts.slice(from, to),
  })

  let build: (s: Slice) => string
  if (task === 'backTranslate') {
    build = s =>
      buildBackTranslationPrompt({
        cues: s.cues,
        numbers: s.numbers,
        fromLang: targetLang,
        toLang: body.sourceLang ?? 'Auto-detect',
      })
  } else if (task === 'shorten') {
    build = s =>
      buildShortenPrompt({
        cues: s.cues,
        sourceTexts: s.sourceTexts,
        numbers: s.numbers,
        lang: targetLang,
        maxChars,
      })
  } else if (task === 'review') {
    build = s =>
      buildReviewPrompt({
        cues: s.cues,
        sourceTexts: s.sourceTexts,
        numbers: s.numbers,
        lang: targetLang,
        sourceLang: body.sourceLang,
        glossary: body.glossary,
      })
  } else if (task === 'revise') {
    if (typeof body.instructions !== 'string' || !body.instructions.trim()) {
      return NextResponse.json(
        { error: 'instructions are required to revise a translation' },
        { status: 400 },
      )
    }
    const instructions = body.instructions
    build = s =>
      buildRevisionPrompt({
        cues: s.cues,
        sourceTexts: s.sourceTexts,
        numbers: s.numbers,
        lang: targetLang,
        maxChars,
        instructions,
        glossary: body.glossary,
      })
  } else if (task === 'translate') {
    build = s =>
      buildTranslationPrompt({
        cues: s.cues,
        numbers: s.numbers,
        targetLang,
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

  // WHICH MATERIAL THIS BELONGS TO.
  //
  // The plans are sold in minutes of material, so a translation has to name the
  // material it is part of or there is nothing to charge. Two answers are
  // valid: an upload, already paid for when it was transcribed, or a saved
  // sequence, which is how subtitles that arrived as a file are measured.
  //
  // Neither is refused rather than waved through. An unsaved import is the one
  // path that could translate a whole feature without ever spending a minute,
  // and the fix is a save, which the message asks for.
  //
  // Only a translation. Everything else here reads or reworks text that is
  // already present — it cannot bring new material in, and the minutes were
  // charged when the material arrived. Demanding an identifier from those would
  // have broken the overlength auto-fix, the QA pass, the correction pass and
  // the review for nothing.
  const sequenceId = typeof body.sequenceId === 'string' ? body.sequenceId : ''
  const mediaId = typeof body.mediaId === 'string' ? body.mediaId : ''

  if (task !== 'translate') {
    // Nothing to charge, nothing to identify.
  } else if (mediaId) {
    // Ownership is the check that matters; the charge happened at transcription.
    if (!(await getMedia(ctx.orgId, mediaId))) {
      return NextResponse.json({ error: 'Unknown media' }, { status: 404 })
    }
  } else if (sequenceId) {
    const sequence = await getSequence(ctx.orgId, sequenceId)
    if (!sequence) return NextResponse.json({ error: 'Unknown sequence' }, { status: 404 })

    // Computed from what is stored, never from the request. A duration the
    // browser supplies is a duration the browser can set to one second.
    const data = sequence.data as { subtitles?: unknown } | null
    await billSequence(ctx.orgId, sequenceId, materialSeconds(data?.subtitles))
  } else {
    return NextResponse.json(
      {
        error:
          'Save this sequence before translating it. The plan is measured in minutes of ' +
          'material, and an unsaved import has nothing to measure yet.',
      },
      { status: 400 },
    )
  }

  try {
    /** One model call, metered whether or not the reply turns out usable. */
    const ask = async (s: Slice): Promise<string> => {
      const { text, tokensIn, tokensOut, model } = await translate(build(s))

      // Metered before parsing, and on every attempt: the tokens were spent
      // whether or not the reply was usable, and a bill that only counts
      // successes under-reports cost.
      await logUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        sequenceId: body.sequenceId ?? null,
        kind: 'translate',
        model,
        unitsIn: tokensIn,
        unitsOut: tokensOut,
        // Priced against whichever model actually answered, which is not always
        // the primary one: a batch served by the fallback is not priced as Gemini.
        costUsd: costUsd(model, { unitsIn: tokensIn, unitsOut: tokensOut }),
        // What the trial is denominated in. Counted here rather than from the
        // reply, so a batch that came back unusable still spends its allowance —
        // the provider charged for it either way.
        cues: s.cues.length,
      })
      return text
    }

    const parse = (text: string, s: Slice): (string | ReviewNote)[] =>
      task === 'review'
        ? parseReviewResponse(text, s.numbers)
        : parseTranslationResponse(text, s.numbers, s.cues)

    const answer = await askInHalves(
      cues.length,
      async (from, to) => {
        const s = slice(from, to)
        // A slice with nothing in it is answered here. Blank cues are never
        // shown to the model, and a prompt with no subtitles in it invites an
        // answer with none — which is the one reply that would be refused.
        if (task !== 'review' && !s.cues.some(c => c.trim())) return s.cues.map(() => '')
        return parse(await ask(s), s)
      },
      CALL_BUDGET,
    )

    // A review answers with notes about the subtitles rather than with
    // subtitles, so nothing here is laid out and nothing is a cue. It leaves by
    // its own door: a caller reading `translations` must never find prose in it.
    if (task === 'review') return NextResponse.json({ notes: answer as ReviewNote[] })

    const translations = answer as string[]

    // Layout happens here, not in the prompt. The model returns one line per
    // cue and this puts the breaks in — the same rules the quality check
    // measures against, so the two can never disagree.
    //
    // Not applied to a back-translation: that text exists to be diffed against
    // the source, and a line break inserted for a reader it never has would
    // show up as a difference nobody wrote.
    const laidOut =
      task === 'backTranslate' ? translations : translations.map(t => reflowText(t, maxChars))

    return NextResponse.json({ translations: laidOut })
  } catch (err) {
    if (err instanceof TranslationFormatError) {
      // The caller can retry this one; it is the model misbehaving, not the request.
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
