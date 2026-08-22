import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TranslationFormatError,
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
