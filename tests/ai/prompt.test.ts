import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TranslationFormatError,
  buildRevisionPrompt,
  buildTranslationPrompt,
  parseTranslationResponse,
} from '../../lib/ai/prompt.ts'

const base = { cues: ['Hola', 'Adiós'], targetLang: 'English', maxChars: 42 }

describe('buildTranslationPrompt', () => {
  it('states the exact cue count, twice', () => {
    // Once as a rule and once in the output instruction: models drop a single
    // mention far more often than a repeated one.
    const p = buildTranslationPrompt(base)
    assert.match(p, /THE SUBTITLE COUNT IS FIXED/)
    assert.match(p, /exactly 2 strings/)
  })

  /**
   * The budget is two lines' worth, because two lines is the ceiling a cue is
   * laid out to. What the model is told is how much text to write; where it
   * breaks is reflowText's decision, made after the reply arrives.
   */
  it('carries the character limit through as a total budget', () => {
    assert.match(buildTranslationPrompt(base), /under 84 characters/)
    assert.match(buildTranslationPrompt({ ...base, maxChars: 32 }), /under 64 characters/)
  })

  /**
   * The rule that keeps the count honest. Asked to break long text, a model
   * that will not write \n opens a second array entry instead, and a batch of
   * thirty comes back as thirty-two — which parseTranslationResponse refuses,
   * losing the whole batch rather than one cue.
   */
  it('forbids line breaks, so a break cannot become an extra entry', () => {
    assert.match(buildTranslationPrompt(base), /NEVER insert line breaks/)
    assert.doesNotMatch(buildTranslationPrompt(base), /characters per line/)
  })

  it('names the source language only when it is known', () => {
    assert.match(buildTranslationPrompt({ ...base, sourceLang: 'Spanish' }), /from Spanish into/)
    assert.doesNotMatch(buildTranslationPrompt({ ...base, sourceLang: 'Auto-detect' }), / from /)
    assert.doesNotMatch(buildTranslationPrompt(base), / from /)
  })

  it('includes the cues as JSON so the model sees the boundaries', () => {
    assert.match(buildTranslationPrompt(base), /\["Hola","Adiós"\]/)
  })

  it('renders glossary entries, including terms to leave alone', () => {
    const p = buildTranslationPrompt({
      ...base,
      glossary: [
        { term: 'Hacienda', translation: 'Tax Office' },
        { term: 'Movistar' },
        { term: '   ' },
      ],
    })
    assert.match(p, /"Hacienda" must be translated as "Tax Office"/)
    assert.match(p, /"Movistar" must be kept unchanged/)
    // A blank row in the glossary table is not an instruction.
    assert.doesNotMatch(p, /"" must be/)
  })

  it('bounds the glossary, which is the one field the caller writes freely', () => {
    const p = buildTranslationPrompt({
      ...base,
      glossary: [
        { term: 'x'.repeat(500), translation: 'y'.repeat(500) },
        // Not a row anybody typed: the shape is whatever arrived over HTTP.
        { term: 42 as unknown as string },
        ...Array.from({ length: 400 }, (_, i) => ({ term: `term${i}` })),
      ],
    })

    const rules = p.split('\n').filter(l => l.startsWith('• "'))
    assert.ok(rules.length <= 200, `the glossary should be capped, got ${rules.length} rules`)
    assert.ok(!rules.some(l => l.length > 500), 'no single rule should carry an essay')
    assert.doesNotMatch(p, /"42"/)
  })

  it('omits optional sections entirely when unused', () => {
    const p = buildTranslationPrompt(base)
    assert.doesNotMatch(p, /GLOSSARY/)
    assert.doesNotMatch(p, /ADDITIONAL INSTRUCTIONS/)
    assert.doesNotMatch(p, /PREVIOUS SUBTITLES/)
  })

  it('passes through extra instructions and prior context', () => {
    const p = buildTranslationPrompt({
      ...base,
      extraInstructions: 'Tutea al espectador',
      previousContext: ['Previously translated line'],
    })
    assert.match(p, /Tutea al espectador/)
    assert.match(p, /Previously translated line/)
  })

  it('bounds the prose the caller writes, as it bounds the glossary', () => {
    const p = buildTranslationPrompt({ ...base, extraInstructions: 'x'.repeat(9_000) })
    const line = p.split('\n').find(l => l.startsWith('xxx'))!
    assert.ok(line.length <= 2_000, `instructions should be clamped, got ${line.length}`)
  })
})

describe('buildRevisionPrompt', () => {
  const revision = {
    cues: ['A nivel varietal, a nivel de producciones', 'Lo embotellamos'],
    sourceTexts: ['At varietal level, at production level', 'We bottle it'],
    numbers: [18, 19],
    lang: 'Spanish',
    maxChars: 42,
    instructions: 'Subtítulo 18: recorta la repetición del anterior.',
  }

  it('keeps the fixed-count contract every other task keeps', () => {
    const p = buildRevisionPrompt(revision)
    assert.match(p, /THE SUBTITLE COUNT IS FIXED/)
    assert.match(p, /exactly 2 strings/)
  })

  it('sends the cue numbers, so a correction naming one can find it', () => {
    // Without these, cue 18 is the eighteenth line of some batch and the
    // eighteenth line of a batch is not cue 18.
    assert.match(buildRevisionPrompt(revision), /\[18,19\]/)
  })

  it('shows the source beside the translation being corrected', () => {
    const p = buildRevisionPrompt(revision)
    assert.match(p, /At varietal level, at production level/)
    assert.match(p, /CURRENT TRANSLATIONS/)
    assert.match(p, /Lo embotellamos/)
    assert.match(p, /recorta la repetición del anterior/)
  })

  it('orders every untouched subtitle returned exactly as it came', () => {
    // The whole point of revising rather than retranslating: a model left to
    // improve what nobody complained about undoes the hand edits already made,
    // and nothing in the reply says which changes were asked for.
    const p = buildRevisionPrompt(revision)
    assert.match(p, /Change ONLY the ones the corrections name/)
    assert.match(p, /EXACTLY as given, character for character/)
  })

  it('bounds the corrections, which are prose the caller writes freely', () => {
    const p = buildRevisionPrompt({ ...revision, instructions: 'y'.repeat(9_000) })
    const line = p.split('\n').find(l => l.startsWith('yyy'))!
    assert.ok(line.length <= 2_000, `corrections should be clamped, got ${line.length}`)
  })

  it('applies the glossary, which a correction pass still has to respect', () => {
    const p = buildRevisionPrompt({ ...revision, glossary: [{ term: 'Terroir' }] })
    assert.match(p, /"Terroir" must be kept unchanged/)
  })
})

describe('parseTranslationResponse', () => {
  it('reads a plain JSON array', () => {
    assert.deepEqual(parseTranslationResponse('["one","two"]', 2), ['one', 'two'])
  })

  it('tolerates markdown fences', () => {
    assert.deepEqual(parseTranslationResponse('```json\n["one","two"]\n```', 2), ['one', 'two'])
  })

  it('rejects a re-segmented batch', () => {
    // The bug this exists for: the model merges or splits cues, and every
    // translation after that point lands on the wrong timecode.
    assert.throws(
      () => parseTranslationResponse('["one","two","three"]', 2),
      (e: Error) => e instanceof TranslationFormatError && /re-segmented/.test(e.message),
    )
    assert.throws(() => parseTranslationResponse('["only one"]', 2), TranslationFormatError)
  })

  it('rejects malformed or wrongly shaped replies', () => {
    assert.throws(() => parseTranslationResponse('not json at all', 1), TranslationFormatError)
    assert.throws(() => parseTranslationResponse('{"a":1}', 1), TranslationFormatError)
    assert.throws(() => parseTranslationResponse('[1,2]', 2), TranslationFormatError)
  })

  it('never substitutes the source text on failure', () => {
    // Silently returning the original would look like a finished translation
    // and ship that way.
    let threw = false
    try {
      parseTranslationResponse('garbage', 2)
    } catch {
      threw = true
    }
    assert.equal(threw, true)
  })
})
