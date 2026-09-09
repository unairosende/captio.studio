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
  // Where a line breaks is lib/subtitles/layout.ts's job, and asking for it here
  // is what made the count unreliable: told to break long text, a model that
  // cannot write \n often opens a second array entry instead — thirty cues came
  // back as thirty-two, and the batch was refused.
  '• NEVER insert line breaks. Return each subtitle as one single line of text.',
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

/**
 * How much prose a caller may put in front of the model in one request.
 *
 * The same reasoning as the glossary limits above, applied to the field that
 * is actually prose. A reviewer's corrections are a handful of lines — "the
 * 18th repeats the end of the 17th, trim it" — and past this somebody is using
 * a subtitle editor as a text box.
 *
 * The cap is the second line of defence, not the first. The output contract is
 * the first: every task here must answer with exactly one string per input cue
 * or `parseTranslationResponse` refuses the batch, so even an instruction that
 * talked the model into writing something else would produce nothing the
 * caller could read back.
 */
const MAX_INSTRUCTION_CHARS = 2_000

/** How long one review note may be. A sentence, not a paragraph. */
const MAX_NOTE_CHARS = 240

/** A prose section, clamped, or nothing at all when there is no prose. */
function instructionBlock(heading: string, text?: string): string[] {
  const trimmed = (text ?? '').trim().slice(0, MAX_INSTRUCTION_CHARS)
  return trimmed ? [heading, trimmed, ''] : []
}

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
    // A budget, not a layout instruction. The model decides how much text to
    // write, which is a translation decision; reflowText decides where it
    // breaks, which is typography and is already solved, tested and free.
    //
    // Asking for both cost 15,000 thinking tokens and seventy seconds a batch,
    // and one run answered with the deliberation itself — «"test confirmador"
    // (16) vs "prueba confirmatoria" (20)» — where the JSON was supposed to be.
    'LENGTH BUDGET:',
    `• Keep each subtitle under ${req.maxChars * 2} characters — prefer shorter wording, never drop meaning`,
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
    ...instructionBlock(
      'ADDITIONAL INSTRUCTIONS (apply to every subtitle):',
      req.extraInstructions,
    ),
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
    'LENGTH BUDGET:',
    `• Keep each subtitle under ${req.maxChars * 2} characters in total`,
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

/**
 * Correct a translation that already exists, without redoing it.
 *
 * The pass a reviewer actually asks for. Retranslating from scratch throws
 * away every fix already made by hand and rolls the dice again on the rest;
 * what somebody wants after reading a draft is these five lines changed and
 * the other ninety-nine left exactly as they are.
 *
 * The source texts go in beside the translations for the same reason they do
 * in `buildShortenPrompt`: without them a correction is applied to wording the
 * model can no longer check against what was said.
 */
export interface RevisionRequest {
  /** The current translations — the text being corrected. */
  cues: string[]
  /** The original cues, in the same order, so a correction cannot drift. */
  sourceTexts: string[]
  /**
   * The cue numbers these translations carry on screen, in the same order.
   *
   * A reviewer writes "subtitle 18 repeats the end of 17", and a request only
   * ever carries a batch — cue 18 is somewhere in the middle of one batch and
   * absent from every other. Without the numbers the model has nothing to
   * match that instruction against, and the batch that does contain cue 18
   * would count it as its own eighteenth line.
   */
  numbers: number[]
  lang: string
  maxChars: number
  /** What to change. The reviewer's own words. */
  instructions: string
  glossary?: GlossaryEntry[]
}

export function buildRevisionPrompt(req: RevisionRequest): string {
  return [
    `You are a professional subtitle editor. Revise these subtitles in ${req.lang} by applying the corrections below.`,
    '',
    'LENGTH BUDGET:',
    `• Keep each subtitle under ${req.maxChars * 2} characters — prefer shorter wording, never drop meaning`,
    '',
    ...FIXED_COUNT_RULES,
    'REVISION RULES:',
    // The instruction the whole feature rests on. A model handed a list of
    // corrections and a batch of subtitles will happily improve the ones
    // nobody complained about, and the reviewer's earlier hand edits go with
    // them — so the batch comes back changed in places they had already
    // settled, and there is no way to tell which changes were asked for.
    '• Return every subtitle. Change ONLY the ones the corrections name or describe',
    '• Reproduce every other subtitle EXACTLY as given, character for character',
    '• A correction naming a subtitle number applies to that number and no other',
    '• If a correction names a number that is not in this batch, ignore it',
    '• Keep the meaning of the original source text — corrections adjust wording, not content',
    '• Maintain consistent terminology throughout',
    '',
    ...glossaryRules(req.glossary),
    ...instructionBlock('CORRECTIONS TO APPLY:', req.instructions),
    `Return ONLY a JSON array of exactly ${req.cues.length} strings — one per input subtitle, same order, same count. No markdown, no commentary.`,
    '',
    'SUBTITLE NUMBERS (same order as the two arrays below):',
    JSON.stringify(req.numbers),
    '',
    'ORIGINAL SOURCE TEXTS (for meaning):',
    JSON.stringify(req.sourceTexts),
    '',
    'CURRENT TRANSLATIONS (revise these):',
    JSON.stringify(req.cues),
  ].join('\n')
}

/**
 * Read the translation and say what is wrong with it.
 *
 * The pass that finds what the quality check cannot measure: a line whose
 * meaning drifted, a term spelled two ways, text duplicated across a split.
 * Its output is notes, not subtitles — so it runs on its own and never shares
 * a reply with a translation. Asking for both in one answer is what taught the
 * model to re-segment in the first place, and every rule in FIXED_COUNT_RULES
 * is a scar from it.
 *
 * Takes no prose from the caller, deliberately. `revise` is where a reviewer's
 * own words belong; a task that accepted free text *and* answered with free
 * text would be a general-purpose model wearing a subtitle editor's clothes.
 */
export function buildReviewPrompt(req: {
  /** The translations to read. */
  cues: string[]
  /** The originals they came from, which is what makes drift visible. */
  sourceTexts: string[]
  /** The numbers these cues carry on screen — every note cites one. */
  numbers: number[]
  lang: string
  sourceLang?: string
  glossary?: GlossaryEntry[]
}): string {
  const from = req.sourceLang && req.sourceLang !== 'Auto-detect' ? ` from ${req.sourceLang}` : ''

  return [
    `You are a senior subtitle reviewer. Read these subtitles translated${from} into ${req.lang} against their source and report only what is wrong.`,
    '',
    'WHAT TO REPORT:',
    '• Text duplicated across two subtitles — the end of one repeated at the start of the next',
    '• Meaning that changed: a negation lost, a tense flipped, a number or name altered',
    '• A term translated one way here and another way elsewhere in the batch',
    '• Capitalisation of a proper name that disagrees with the rest of the batch',
    '• Wording no native speaker would use',
    '',
    'WHAT NOT TO REPORT:',
    // Left to itself a model writes one note per subtitle, because it was asked
    // for notes and an empty answer feels like a failure. A hundred notes that
    // each say "this is fine, though you could consider…" is not a review; it is
    // a wall nobody reads twice, and it buries the four that mattered.
    '• Anything you would describe as "fine", "good", "acceptable" or "could be slightly better"',
    '• Style preferences, alternative phrasings, or praise',
    '• Line length, reading speed and timing — those are measured elsewhere, not by you',
    '',
    'RULES:',
    '• Report NOTHING unless it is a real mistake a professional would correct',
    '• An empty array is the correct answer for a batch with no mistakes — return it',
    '• At most one note per subtitle',
    // The anchor that keeps a review honest. A model asked for problems will
    // produce problems, and the invented ones read exactly like the real ones
    // — until it has to quote the words, at which point there is nothing to
    // quote. It also fixes the number: the quote and the "n" come off the same
    // object, so there is no arithmetic left to get wrong.
    '• Every note must quote the exact words it is about, copied character for character from that subtitle\'s "translation"',
    '• "cue" is the "n" of the subtitle you quoted. Do not report a note against any other number',
    `• Each note is one sentence, under ${MAX_NOTE_CHARS} characters, naming what is wrong and what it should be`,
    '• "level" is "error" when the meaning is wrong, "warn" when it reads badly but says the right thing',
    '',
    ...glossaryRules(req.glossary),
    'Return ONLY a JSON array of objects, each {"cue": <n>, "level": "error"|"warn", "note": "<text>"}. No markdown, no commentary.',
    '',
    // One object per subtitle rather than three arrays to be read in step.
    // Parallel arrays made the model count, and it counted wrong: a fault in
    // the sixth subtitle came back filed against the fifth, which is worse
    // than no review at all — it sends somebody to correct a line that is
    // already right.
    'SUBTITLES:',
    JSON.stringify(
      req.numbers.map((n, i) => ({
        n,
        source: req.sourceTexts[i] ?? '',
        translation: req.cues[i] ?? '',
      })),
    ),
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

/** One thing a reviewer would fix, tied to the cue it is about. */
export interface ReviewNote {
  /** The cue number on screen, not a position in any batch. */
  cue: number
  level: 'warn' | 'error'
  note: string
}

/**
 * Read the review, and bound it.
 *
 * Every other task here answers with exactly one string per input cue, and
 * that shared shape is what stops any of them being used to get arbitrary text
 * out of a subtitling subscription. A review cannot keep it — notes are prose,
 * and there are fewer of them than there are cues.
 *
 * So it is bounded deliberately rather than by luck: at most one note per cue
 * in the batch, each clamped to a sentence, and every note naming a cue this
 * batch does not contain is dropped. What comes back is still shaped by the
 * subtitles that went in. Together with the prompt taking no prose from the
 * caller, there is no request whose reply is larger or freer than the material
 * it was asked about.
 *
 * Malformed replies are dropped entry by entry rather than refused wholesale.
 * A miscounted translation has to be refused because every later cue would
 * land on the wrong timecode; a review that came back with one unusable note
 * still has the other nine, and losing them would be the more expensive
 * mistake.
 */
export function parseReviewResponse(raw: string, cueNumbers: number[]): ReviewNote[] {
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

  const inBatch = new Set(cueNumbers)
  const seen = new Set<number>()
  const notes: ReviewNote[] = []

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const { cue, level, note } = entry as Record<string, unknown>

    // A note about a cue that is not here cannot be shown next to anything.
    if (typeof cue !== 'number' || !inBatch.has(cue) || seen.has(cue)) continue

    const text = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_CHARS) : ''
    if (!text) continue

    seen.add(cue)
    notes.push({ cue, level: level === 'error' ? 'error' : 'warn', note: text })
  }

  return notes
}
