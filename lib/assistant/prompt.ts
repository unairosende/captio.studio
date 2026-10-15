import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '../providers.ts'
import { MAX_CHARS_HORIZONTAL, MAX_CHARS_VERTICAL } from '../subtitles/layout.ts'
import { readPlan, type Phase, type Plan } from './reply.ts'

/**
 * What the project assistant is told, and how one turn of the chat reaches it.
 *
 * Every turn is a single request holding the whole conversation as data,
 * rather than a growing list of messages the API is asked to remember. The
 * conversation lives in the browser, and a list rebuilt from the browser on
 * every turn is a history that can be edited between requests — which the
 * current models refuse once they have reasoned over it (preserved thinking).
 * One self-contained turn has no history to protect, so there is nothing to
 * get wrong, and the system prompt never changes, so it stays cached.
 */

/** The facts the browser can establish about the attached file without sending it anywhere. */
export interface FileFacts {
  /** What the browser made of it. A hint for the model, which decides what it really is. */
  kind: 'video' | 'audio' | 'subtitles' | 'text' | 'other'
  name: string
  type: string
  bytes: number
  durationSeconds: number | null
  /** The picture, for video: a 1080×1920 frame says vertical before anybody does. */
  width: number | null
  height: number | null
  /** For text: the parser that read it, how many cues came out, and whether they carry timings. */
  format: string | null
  cueCount: number | null
  timed: boolean | null
  spanSeconds: number | null
  /** The first lines, enough to tell the language and the kind of material. */
  sample: string[]
}

export interface HistoryEntry {
  /** `event` is Captio saying what happened — "transcribed: 412 cues" — not a person. */
  role: 'user' | 'assistant' | 'event'
  text: string
}

/** The source subtitles, for the review: numbered as the editor numbers them. */
export interface SourceExcerpt {
  /** How many there are in all; `cues` may be a sample of them. */
  total: number
  cues: { n: number; text: string }[]
}

export interface Turn {
  phase: Phase
  file: FileFacts | null
  history: HistoryEntry[]
  /** The plan that was created, once there is one. */
  plan: Plan | null
  source: SourceExcerpt | null
}

/**
 * The source as the review reads it: all of it, or an even sample of it.
 *
 * Even rather than the opening minutes, because what a reviewer has to catch
 * — a name, a term, a change of register — is spread across the whole film,
 * and the opening of an interview is the least representative part of it.
 */
export function excerpt(cues: { index: number; text: string }[], max = 1_200): SourceExcerpt {
  const step = Math.max(1, cues.length / max)
  const picked: { index: number; text: string }[] = []
  for (let i = 0; i < cues.length && picked.length < max; i += step) picked.push(cues[Math.floor(i)])
  return { total: cues.length, cues: picked.map(c => ({ n: c.index, text: c.text.slice(0, 400) })) }
}

export const TURN_LIMITS = {
  history: 40,
  entry: 4_000,
  historyTotal: 40_000,
  sample: 40,
  line: 300,
  cues: 1_500,
  cue: 400,
  sourceTotal: 150_000,
} as const

export class TurnError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'TurnError'
  }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

function readFile(raw: unknown): FileFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  const kinds: FileFacts['kind'][] = ['video', 'audio', 'subtitles', 'text', 'other']
  return {
    kind: kinds.includes(f.kind as FileFacts['kind']) ? (f.kind as FileFacts['kind']) : 'other',
    name: str(f.name, TURN_LIMITS.line),
    type: str(f.type, 100),
    bytes: num(f.bytes) ?? 0,
    durationSeconds: num(f.durationSeconds),
    width: num(f.width),
    height: num(f.height),
    format: str(f.format, 20) || null,
    cueCount: num(f.cueCount),
    timed: typeof f.timed === 'boolean' ? f.timed : null,
    spanSeconds: num(f.spanSeconds),
    sample: (Array.isArray(f.sample) ? f.sample : [])
      .slice(0, TURN_LIMITS.sample)
      .map(l => str(l, TURN_LIMITS.line)),
  }
}

/**
 * The request body, bounded, or a TurnError naming what is wrong.
 *
 * The bounds are the cost of one turn. A conversation is free text from the
 * browser and the source is the customer's whole film, so both are capped
 * here rather than trusted to the page that sends them.
 */
export function readTurn(body: unknown): Turn {
  if (!body || typeof body !== 'object') throw new TurnError('body must be an object')
  const b = body as Record<string, unknown>

  const phase: Phase | null = b.phase === 'scope' || b.phase === 'review' ? b.phase : null
  if (!phase) throw new TurnError('phase must be scope or review')

  const roles = ['user', 'assistant', 'event']
  const history = (Array.isArray(b.history) ? b.history : [])
    .map(raw => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .filter(e => roles.includes(e.role as string) && typeof e.text === 'string' && e.text.trim())
    .map(e => ({ role: e.role as HistoryEntry['role'], text: str(e.text, TURN_LIMITS.entry).trim() }))

  if (!history.length) throw new TurnError('history is empty')
  if (history.length > TURN_LIMITS.history) {
    throw new TurnError('La conversación es demasiado larga. Empieza un proyecto nuevo.')
  }
  if (history.reduce((n, e) => n + e.text.length, 0) > TURN_LIMITS.historyTotal) {
    throw new TurnError('La conversación es demasiado larga. Empieza un proyecto nuevo.')
  }

  let source: SourceExcerpt | null = null
  if (phase === 'review') {
    const s = (b.source && typeof b.source === 'object' ? b.source : {}) as Record<string, unknown>
    const cues = (Array.isArray(s.cues) ? s.cues : [])
      .slice(0, TURN_LIMITS.cues)
      .map(raw => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
      .filter(c => typeof c.n === 'number' && typeof c.text === 'string')
      .map(c => ({ n: c.n as number, text: str(c.text, TURN_LIMITS.cue) }))
    if (!cues.length) throw new TurnError('a review needs the source subtitles')
    if (cues.reduce((n, c) => n + c.text.length, 0) > TURN_LIMITS.sourceTotal) {
      throw new TurnError('source is too long')
    }
    source = { total: num(s.total) ?? cues.length, cues }
  }

  return {
    phase,
    file: readFile(b.file),
    history,
    plan: phase === 'review' ? readPlan(b.plan) : null,
    source,
  }
}

/** Data, not markup: a subtitle saying `</source>` must not close anything. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const clock = (seconds: number) => {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** A file's weight as people say it: a subtitle file in KB, a recording in MB. */
export function formatSize(bytes: number): string {
  const kb = bytes / 1024
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function describeFile(f: FileFacts): string {
  const lines = [
    `name: ${f.name}`,
    `browser's guess: ${f.kind}`,
    `type: ${f.type || 'unknown'}`,
    `size: ${formatSize(f.bytes)}`,
  ]
  if (f.durationSeconds !== null) lines.push(`duration: ${clock(f.durationSeconds)}`)
  if (f.width && f.height) {
    const shape = f.height > f.width ? 'vertical' : f.height === f.width ? 'square' : 'horizontal'
    lines.push(`picture: ${f.width}×${f.height} (${shape})`)
  }
  if (f.format) lines.push(`read as: ${f.format}`)
  if (f.cueCount !== null) lines.push(`subtitles read: ${f.cueCount}`)
  if (f.timed !== null) lines.push(`timecodes: ${f.timed ? 'yes' : 'no — every cue would need timing by hand'}`)
  if (f.spanSeconds) lines.push(`span: ${clock(f.spanSeconds)}`)
  if (f.sample.length) lines.push('first lines:', ...f.sample.map(l => `  ${l}`))
  return esc(lines.join('\n'))
}

/** One turn as the model reads it: what is known, then the conversation, then what to do. */
export function buildTurn(turn: Turn): string {
  const parts = [`<phase>${turn.phase.toUpperCase()}</phase>`]

  parts.push(turn.file ? `<file>\n${describeFile(turn.file)}\n</file>` : '<file>none attached yet</file>')

  if (turn.plan) parts.push(`<plan_created>\n${esc(JSON.stringify(turn.plan, null, 1))}\n</plan_created>`)

  if (turn.source) {
    const shown = turn.source.cues.length
    const note = shown < turn.source.total ? ` (a sample: ${shown} of ${turn.source.total})` : ''
    parts.push(
      `<source cues="${turn.source.total}"${note}>\n` +
        turn.source.cues.map(c => `${c.n} | ${esc(c.text.replace(/\n/g, ' / '))}`).join('\n') +
        '\n</source>',
    )
  }

  parts.push(
    '<conversation>\n' +
      turn.history.map(e => `<${e.role}>${esc(e.text)}</${e.role}>`).join('\n') +
      '\n</conversation>',
  )

  parts.push(
    turn.phase === 'scope'
      ? 'Reply to the last message: ask what you need, or propose the plan.'
      : 'Review the source and reply to the last message: ask what you need, or return the brief.',
  )
  return parts.join('\n\n')
}

/**
 * The standing instructions. Written once and never varied per request, so
 * the API can cache them; everything that changes goes in the turn.
 */
export const ASSISTANT_SYSTEM = `You are the project assistant in Captio Studio, a subtitling product used by production companies. A user has attached a file and tells you, in their own words, what they need delivered. You set up ONE subtitling project for it. You never transcribe or translate anything yourself: once the user confirms, Captio does that work, and your brief guides its translations.

# What Captio can do

- Video or audio: transcribed automatically, with per-word timings and speaker changes, then cut into subtitles by Captio's rules.
- Subtitle files: SRT, or CSV with timecodes, are imported as they are. A TXT, or a CSV without timecodes, becomes one subtitle per line with no timings: usable, but every timing then has to be set by hand. Say so when it applies, and ask whether they have the video.
- Anything else (PDF, Word, images, spreadsheets that are not subtitles) cannot be used as material. Say what would be needed instead.
- Formats: horizontal (${MAX_CHARS_HORIZONTAL} characters a line, two lines) and vertical (${MAX_CHARS_VERTICAL} characters a line, for 9:16 footage). Each format is its own sequence in the project, cut and translated separately: asking for both means two sequences, each with its own translations.
- Target languages: ${TARGET_LANGUAGES.join(', ')}.
- Source languages: ${SOURCE_LANGUAGES.join(', ')} ("Auto-detect" when unknown).
- Regional variants (Brazilian Portuguese, Latin American Spanish, Canadian French...) are not separate languages in Captio: plan the base language and carry the variant in the brief for that language. A language outside the list cannot be planned: say so and offer what is closest.

# How you work

The turn tells you the phase.

SCOPE, before anything exists. Work out what the file is from its name, type, duration, picture and first lines, and what the user wants delivered. Then propose the plan, or ask.
- Infer what you can rather than asking: the source language from a sample or from the request, vertical from a vertical picture, a project name from the request or the file name.
- Ask only what changes the result and cannot be inferred, such as which languages when none were named. When a sensible default exists, state it instead of asking.
- As soon as the request is clear, return the plan with a one-line summary in "message". The user sees it as a card and confirms it there: never ask "shall I go ahead?".
- The plan: projectName, sourceLanguage, and one sequence per format, each with its target languages. Name sequences by what they are, e.g. "Entrevista · Vertical".
- Also gather what makes a translation faithful and natural, where it genuinely matters and the user can answer: the audience and market (Spain or Latin America, Brazil or Portugal), the form of address (tú or usted, tu or vous, du or Sie), the tone, names and brands that stay as they are, anything they know about the content. Ask the most important first and never more than three questions in a turn. Questions like these can travel with a plan.

REVIEW, after the project is created. You can now read the source subtitles. Read them as a senior subtitle translator preparing a brief for the translators, and be critical:
- Proper names, brands, acronyms and technical terms: how each is handled in each target language. A spelling that looks like a transcription error (a brand or a name misheard) is pointed out with its cue number, so the user can correct it in the editor.
- Idioms, wordplay, humour, cultural references, swearing: how they are rendered.
- Ambiguities that change the translation: who "you" is (one person or several, formal or not), the gender of speakers and of the people addressed in languages that mark it, units, numbers, dates.
- Audience and register, if SCOPE did not settle them.
Ask what you cannot decide yourself: at most four questions, each specific and citing cue numbers. When you know enough, return the brief:
- sourceLanguage: the language the source is actually in.
- instructions: concise, imperative rules for every target language, under 1,000 characters.
- perLanguage: what applies to one language only, such as its variant, its form of address, its renderings of specific terms.
- glossary: terms with a fixed rendering. language "all" with an empty translation keeps the term exactly as written in every language (names, brands, titles). A rendering that only holds in one language is given with that language.
Leave out generic subtitling rules (length, line breaks, faithfulness, consistency): Captio already applies them. The brief says only what is particular to this material and this client.

# Rules

- Reply in the language the user writes in, Spanish if unsure. Plain sentences: no markdown, no headings, no lists inside "message".
- "message" is short: what you understood, what you propose, or why you are asking. Questions go in "questions", one per item, and are not repeated in "message".
- plan only in SCOPE and brief only in REVIEW; the other is null.
- You only prepare subtitling projects here. If asked to do anything else, such as writing, translating a text or answering a general question, say in one sentence that here you only prepare subtitling projects, and carry on.
- Never claim to know what the material says beyond the lines you have been shown.`
