export interface GlossaryEntry {
  term: string
  /** Empty means "leave this term exactly as written". */
  translation?: string
}

export interface TranslationRequest {
  /** Cue texts, in order. */
  cues: string[]
  targetLang: string
  /** Omitted or 'Auto-detect' lets the model work it out. */
  sourceLang?: string
  maxChars: number
  glossary?: GlossaryEntry[]
  extraInstructions?: string
  /** Already-translated cues, for terminology consistency across batches. */
  previousContext?: string[]
}

/**
 * The rule that cost the most to find.
 *
 * Models left to their own devices re-segment: they merge two short cues or
 * split a long one, and the batch comes back with a different number of entries
 * than it went in with. Every translation after that point is attached to the
 * wrong timecode, which looks like a translation quality problem and is not.
 *
 * The count is restated as a hard constraint here, and verified in
 * `parseTranslationResponse` — asking is not enough on its own.
 */
const FIXED_COUNT_RULES = [
  'CRITICAL — THE SUBTITLE COUNT IS FIXED: return exactly one translation per input subtitle, in the same order.',
  '• NEVER split one subtitle into two entries, and NEVER merge two subtitles into one.',
  '• If a translation is too long, break it into at most 2 lines using \\n INSIDE that same entry.',
  '• Put that line break at punctuation or a conjunction — never mid-phrase.',
  '',
]

/**
 * What a glossary may be, so that it cannot become something else.
 *
 * It is the one part of this prompt written freely by the caller, and the
 * prompt is composed on the server precisely so that a subtitling subscription
 * cannot be spent as a general-purpose model. A few dozen short terms is what
 * the feature is; past these limits somebody is using a terminology table as a
 * text box.
 */
const MAX_GLOSSARY_ENTRIES = 200
const MAX_GLOSSARY_CHARS = 200

const clean = (v: unknown): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_GLOSSARY_CHARS) : ''

function glossaryRules(entries: GlossaryEntry[] = []): string[] {
  const used = entries
    .slice(0, MAX_GLOSSARY_ENTRIES)
    .map(g => ({ term: clean(g?.term), translation: clean(g?.translation) }))
    .filter(g => g.term)

  if (!used.length) return []
  return [
    'GLOSSARY (overrides every rule above — apply exactly):',
    ...used.map(g =>
      g.translation
        ? `• "${g.term}" must be translated as "${g.translation}"`
        : `• "${g.term}" must be kept unchanged, exactly as written`,
    ),
    '',
  ]
}

/**
 * Compose the translation prompt.
 *
 * This lives on the server, and the client sends cues rather than prose. When
 * the client supplied the prompt, any paying subscriber could send arbitrary
 * text and use our AI credit as a general-purpose model — the subscription
 * bought a subtitle translator, not an LLM to resell.
 */
export function buildTranslationPrompt(req: TranslationRequest): string {
  const from = req.sourceLang && req.sourceLang !== 'Auto-detect' ? ` from ${req.sourceLang}` : ''

  return [
    `You are a professional subtitle translator. Translate the following subtitles${from} into ${req.targetLang}.`,
    '',
    'FORMAT CONSTRAINTS (hard limits — never exceed):',
    `• Max ${req.maxChars} characters per line`,
    '• Max 2 lines per subtitle — use \\n to split long lines',
    '',
    ...FIXED_COUNT_RULES,
    'TRANSLATION RULES:',
    '• Translate LITERALLY and EXACTLY — word for word as much as the target language allows',
    `• Preserve the original sentence structure and word order whenever grammatically possible in ${req.targetLang}`,
    '• Do NOT paraphrase, summarize, or interpret — reproduce the exact meaning',
    '• Do NOT add, remove, or change any word unless grammar strictly requires it',
    '• Keep proper names, brand names, and technical terms exactly as in the source',
    '• Maintain consistent terminology throughout',
    '',
    ...glossaryRules(req.glossary),
    ...(req.extraInstructions?.trim()
      ? ['ADDITIONAL INSTRUCTIONS (apply to every subtitle):', req.extraInstructions.trim(), '']
      : []),
    ...(req.previousContext?.length
      ? [
          'PREVIOUS SUBTITLES (already translated — use for terminology consistency):',
          req.previousContext.join('\n'),
          '',
        ]
      : []),
    `Return ONLY a JSON array of exactly ${req.cues.length} strings — one per input subtitle, same order, same count. No markdown, no commentary.`,
    '',
    'SOURCE:',
    JSON.stringify(req.cues),
  ].join('\n')
}

/**
 * Translate back to the source language, to see what the translation lost.
 *
 * Literal on purpose: this is a diagnostic, not a deliverable. A fluent
 * back-translation would paper over exactly the drift it exists to reveal.
 */
export function buildBackTranslationPrompt(req: {
  cues: string[]
  fromLang: string
  toLang: string
}): string {
  const to = req.toLang === 'Auto-detect' ? 'the original language' : req.toLang
  return [
    `You are a professional subtitle translator. Translate each subtitle from ${req.fromLang} back to ${to}.`,
    '',
    'RULES:',
    '• Translate literally and accurately — this is for quality checking, not for delivery',
    '• Keep line breaks using \\n if the source has them',
    '',
    ...FIXED_COUNT_RULES,
    `Return ONLY a JSON array of exactly ${req.cues.length} strings — one per input subtitle, same order, same count. No markdown, no commentary.`,
    '',
    'SOURCE:',
    JSON.stringify(req.cues),
  ].join('\n')
}

/**
 * Rewrite over-long cues to fit.
 *
 * The original source text goes in alongside the translation: without it the
 * model shortens by guessing what matters, and what gets dropped is whatever
 * the translator chose to keep.
 */
export function buildShortenPrompt(req: {
  cues: string[]
  sourceTexts: string[]
  lang: string
  maxChars: number
}): string {
  return [
    `You are a professional subtitle editor. Each subtitle in ${req.lang} is too long.`,
    '',
    'FORMAT CONSTRAINTS (hard limits — never exceed):',
    `• Max ${req.maxChars} characters per line`,
    '• Max 2 lines per subtitle — use \\n to split long lines',
    '• Put that line break at punctuation or a conjunction — never mid-phrase',
    '',
    'RULES:',
    '• Rephrase only as much as needed to fit — keep the exact same meaning',
    '• Do NOT drop information; compress wording instead',
    '',
    ...FIXED_COUNT_RULES,
    `Return ONLY a JSON array of exactly ${req.cues.length} strings — one per input subtitle, same order, same count. No markdown, no commentary.`,
    '',
    'ORIGINAL SOURCE TEXTS (for meaning):',
    JSON.stringify(req.sourceTexts),
    '',
    'CURRENT TRANSLATIONS (too long — rewrite these):',
    JSON.stringify(req.cues),
  ].join('\n')
}

export class TranslationFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslationFormatError'
  }
}

/**
 * Read the model's reply, or refuse it.
 *
 * Never falls back to the source text. A cue that silently stays untranslated
 * looks like a finished job and ships that way; a visible error does not.
 */
export function parseTranslationResponse(raw: string, expected: number): string[] {
  const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new TranslationFormatError(`model returned malformed JSON — ${cleaned.slice(0, 120)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new TranslationFormatError('model returned something other than an array')
  }

  // The re-segmentation guard. A mismatch means every cue from the first
  // difference onward would land on the wrong timecode.
  if (parsed.length !== expected) {
    throw new TranslationFormatError(
      `model returned ${parsed.length} translations for ${expected} subtitles — it re-segmented the batch`,
    )
  }

  if (!parsed.every(x => typeof x === 'string')) {
    throw new TranslationFormatError('model returned a non-string entry')
  }

  return parsed as string[]
}
