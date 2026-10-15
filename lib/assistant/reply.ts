import type { GlossaryEntry } from '../ai/prompt.ts'
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '../providers.ts'
import type { OutputMode } from '../subtitles/layout.ts'

/**
 * What the project assistant may answer, and the check every answer passes.
 *
 * The assistant is a model reading free prose, which is the one thing the
 * translate route was rebuilt to refuse: prose in, prose out, and a subtitling
 * subscription becomes a general-purpose model anybody with an account can
 * point at anything. So the answer is not prose. It is this shape, enforced
 * twice — by the API, which constrains the reply to REPLY_SCHEMA, and here,
 * because a schema says what a field is and not what it may contain. A
 * language Captio cannot translate into, a fifth sequence, a brief longer than
 * the prompt it will be pasted into: all of those are valid JSON.
 *
 * Pure, so the rules are argued about in tests rather than in production.
 */

/** Before the project exists, and after: see lib/assistant/prompt.ts. */
export type Phase = 'scope' | 'review'

export interface PlannedSequence {
  name: string
  format: OutputMode
  /** Interface names, as in TARGET_LANGUAGES. May be empty: a transcript only. */
  targetLanguages: string[]
}

/** What gets created when the user says yes. */
export interface Plan {
  projectName: string
  sourceLanguage: string
  sequences: PlannedSequence[]
}

/** A term with a fixed rendering. `language: 'all'` with no translation keeps it as written everywhere. */
export interface BriefTerm {
  term: string
  language: string
  translation: string
}

/** What every translation of this material is told, beyond Captio's own rules. */
export interface Brief {
  /** The language the source turned out to be in, read from the text itself. */
  sourceLanguage: string
  instructions: string
  perLanguage: { language: string; instructions: string }[]
  glossary: BriefTerm[]
}

export interface Reply {
  message: string
  questions: string[]
  plan: Plan | null
  brief: Brief | null
}

export const LIMITS = {
  message: 2_000,
  questions: 5,
  question: 400,
  name: 200,
  sequences: 4,
  /**
   * Shared with the translation prompt, which clamps what it is given at 2,000
   * characters (MAX_INSTRUCTION_CHARS in lib/ai/prompt.ts). The general rules
   * and one language's rules travel together, so together they have to fit.
   */
  instructions: 1_200,
  languageInstructions: 600,
  glossary: 60,
  term: 200,
} as const

export class ReplyFormatError extends Error {
  readonly status = 502
  constructor(reason: string) {
    super(`El asistente respondió algo que Captio no puede usar (${reason}). Vuelve a intentarlo.`)
    this.name = 'ReplyFormatError'
  }
}

const FORMATS: OutputMode[] = ['horizontal', 'vertical']

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

/**
 * The JSON schema the API holds the reply to.
 *
 * Every property required and nothing else allowed, which is what structured
 * outputs ask for. Lengths are not expressible there (the API ignores
 * `maxLength`), so they are clamped in `readReply`.
 */
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'questions', 'plan', 'brief'],
  properties: {
    message: { type: 'string', description: 'What to say to the user, in their language. Short.' },
    questions: {
      type: 'array',
      description: 'Questions for the user, one per item. Empty when there is nothing to ask.',
      items: { type: 'string' },
    },
    plan: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['projectName', 'sourceLanguage', 'sequences'],
      properties: {
        projectName: { type: 'string' },
        sourceLanguage: { type: 'string', enum: SOURCE_LANGUAGES },
        sequences: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'format', 'targetLanguages'],
            properties: {
              name: { type: 'string' },
              format: { type: 'string', enum: FORMATS },
              targetLanguages: { type: 'array', items: { type: 'string', enum: TARGET_LANGUAGES } },
            },
          },
        },
      },
    }),
    brief: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['sourceLanguage', 'instructions', 'perLanguage', 'glossary'],
      properties: {
        sourceLanguage: { type: 'string', enum: SOURCE_LANGUAGES },
        instructions: { type: 'string' },
        perLanguage: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['language', 'instructions'],
            properties: {
              language: { type: 'string', enum: TARGET_LANGUAGES },
              instructions: { type: 'string' },
            },
          },
        },
        glossary: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['term', 'language', 'translation'],
            properties: {
              term: { type: 'string' },
              language: { type: 'string', enum: ['all', ...TARGET_LANGUAGES] },
              translation: { type: 'string' },
            },
          },
        },
      },
    }),
  },
} as const

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const isTarget = (lang: unknown): lang is string =>
  typeof lang === 'string' && (TARGET_LANGUAGES as readonly string[]).includes(lang)

const isSource = (lang: unknown): lang is string =>
  typeof lang === 'string' && (SOURCE_LANGUAGES as readonly string[]).includes(lang)

/** A plan as the model proposed it, or as the browser sends it back: either way checked again. */
export function readPlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  const sourceLanguage = isSource(p.sourceLanguage) ? p.sourceLanguage : 'Auto-detect'
  const projectName = text(p.projectName, LIMITS.name) || 'Proyecto nuevo'

  const sequences = list(p.sequences)
    .slice(0, LIMITS.sequences)
    .map((raw, i): PlannedSequence | null => {
      if (!raw || typeof raw !== 'object') return null
      const q = raw as Record<string, unknown>
      const format = FORMATS.includes(q.format as OutputMode) ? (q.format as OutputMode) : null
      if (!format) return null
      // Translating into the language it is already in is not a translation,
      // and asking twice for one language is one language.
      const targetLanguages = [...new Set(list(q.targetLanguages).filter(isTarget))].filter(
        l => l !== sourceLanguage,
      )
      const name =
        text(q.name, LIMITS.name) ||
        `${projectName} · ${format === 'vertical' ? 'Vertical' : 'Horizontal'}${i ? ` ${i + 1}` : ''}`
      return { name, format, targetLanguages }
    })
    .filter((q): q is PlannedSequence => q !== null)

  // A plan that creates nothing is not a plan; the reply still stands without it.
  if (!sequences.length) return null
  return { projectName, sourceLanguage, sequences }
}

function readBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>

  // One entry per language: a second set of rules for French would be pasted
  // after the first, and whichever the model read last would win.
  const perLanguage: Brief['perLanguage'] = []
  for (const raw of list(b.perLanguage)) {
    const l = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const instructions = text(l.instructions, LIMITS.languageInstructions)
    if (!isTarget(l.language) || !instructions || perLanguage.some(p => p.language === l.language)) continue
    perLanguage.push({ language: l.language, instructions })
  }

  const glossary = list(b.glossary)
    .map(raw => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .map(g => ({
      term: text(g.term, LIMITS.term),
      language: g.language === 'all' || isTarget(g.language) ? (g.language as string) : '',
      translation: text(g.translation, LIMITS.term),
    }))
    .filter(g => g.term && g.language)
    .slice(0, LIMITS.glossary)

  return {
    sourceLanguage: isSource(b.sourceLanguage) ? b.sourceLanguage : 'Auto-detect',
    instructions: text(b.instructions, LIMITS.instructions),
    perLanguage,
    glossary,
  }
}

/**
 * The reply, checked and clamped, or a ReplyFormatError.
 *
 * Clamped rather than refused where something usable survives: a question
 * that runs long is still a question. Refused only when nothing is left to
 * show — a reply with neither words, questions, plan nor brief is the model
 * misbehaving, and the person in the chat should be told so rather than shown
 * an empty bubble.
 *
 * The phase decides which of plan and brief may come back. A plan in review
 * would offer to create a project that already exists; a brief in scope would
 * be a brief written without having read the material.
 */
export function readReply(raw: unknown, phase: Phase): Reply {
  if (!raw || typeof raw !== 'object') throw new ReplyFormatError('no es un objeto')
  const r = raw as Record<string, unknown>

  const reply: Reply = {
    message: text(r.message, LIMITS.message),
    questions: list(r.questions)
      .map(q => text(q, LIMITS.question))
      .filter(Boolean)
      .slice(0, LIMITS.questions),
    plan: phase === 'scope' ? readPlan(r.plan) : null,
    brief: phase === 'review' ? readBrief(r.brief) : null,
  }

  if (!reply.message && !reply.questions.length && !reply.plan && !reply.brief) {
    throw new ReplyFormatError('vacío')
  }
  return reply
}

/** The prose a translation of one language is given: the general rules, then that language's own. */
export function instructionsFor(brief: Brief, language: string): string {
  const own = brief.perLanguage.find(l => l.language === language)?.instructions ?? ''
  return [brief.instructions, own && `${language}: ${own}`].filter(Boolean).join('\n')
}

/** The terms a translation into one language must obey: the ones for every language, and its own. */
export function glossaryFor(brief: Brief, language: string): GlossaryEntry[] {
  return brief.glossary
    .filter(g => g.language === 'all' || g.language === language)
    .map(g => (g.translation ? { term: g.term, translation: g.translation } : { term: g.term }))
}

/**
 * The terms worth keeping on the project for good.
 *
 * Only the ones that hold in every language. The project's glossary is one
 * list for all of them (lib/ai/prompt.ts sends it with every batch whatever
 * the target), so a rendering into French stored there would be imposed on the
 * German.
 */
export function projectTerms(brief: Brief): GlossaryEntry[] {
  const everywhere = glossaryFor(brief, 'all')
  return everywhere.filter((g, i) => everywhere.findIndex(o => o.term === g.term) === i)
}
