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

  it('carries the character limit through', () => {
    assert.match(buildTranslationPrompt(base), /Max 42 characters per line/)
    assert.match(buildTranslationPrompt({ ...base, maxChars: 32 }), /Max 32 characters per line/)
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
