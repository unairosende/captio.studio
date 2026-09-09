import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TranslationFormatError,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildTranslationPrompt,
  parseReviewResponse,
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

describe('buildReviewPrompt', () => {
  const review = {
    cues: ['Lo intentamos mejorar. No había mucha más información,', 'sobre el suelo.'],
    sourceTexts: ['We tried to improve it. There is far more information now,', 'about the soil.'],
    numbers: [17, 18],
    lang: 'Spanish',
    sourceLang: 'English',
  }

  it('pairs each subtitle with its number in one object', () => {
    // Three arrays to be read in step made the model count, and it counted
    // wrong: a fault in the sixth subtitle came back filed against the fifth.
    const p = buildReviewPrompt(review)
    assert.match(p, /"n":17/)
    assert.match(p, /"source":"We tried to improve it/)
    assert.match(p, /"translation":"Lo intentamos mejorar/)
  })

  it('makes the model quote what it is complaining about', () => {
    // The anchor that keeps a review honest: asked for problems, a model
    // produces problems, and the invented ones read exactly like the real ones
    // until it has to quote words that are not there.
    assert.match(buildReviewPrompt(review), /quote the exact words/)
  })

  it('says that finding nothing is an answer', () => {
    assert.match(buildReviewPrompt(review), /empty array is the correct answer/)
  })

  it('leaves length and timing to the checks that measure them', () => {
    assert.match(buildReviewPrompt(review), /those are measured elsewhere/)
  })
})

describe('parseReviewResponse', () => {
  const batch = [17, 18, 19]

  it('reads notes and keeps the cue numbers they name', () => {
    const notes = parseReviewResponse(
      '[{"cue":17,"level":"error","note":"The meaning is inverted."}]',
      batch,
    )
    assert.deepEqual(notes, [{ cue: 17, level: 'error', note: 'The meaning is inverted.' }])
  })

  it('accepts an empty review', () => {
    assert.deepEqual(parseReviewResponse('[]', batch), [])
  })

  it('drops a note about a cue this batch does not contain', () => {
    // It would otherwise be shown beside whatever cue 84 happens to be, and
    // send somebody to correct a line that is already right.
    assert.deepEqual(parseReviewResponse('[{"cue":84,"level":"error","note":"x"}]', batch), [])
  })

  it('keeps one note per cue', () => {
    const notes = parseReviewResponse(
      '[{"cue":17,"level":"warn","note":"first"},{"cue":17,"level":"error","note":"second"}]',
      batch,
    )
    assert.equal(notes.length, 1)
    assert.equal(notes[0].note, 'first')
  })

  it('clamps a note to a sentence and an unknown level to a warning', () => {
    const notes = parseReviewResponse(
      JSON.stringify([{ cue: 18, level: 'catastrophic', note: 'z'.repeat(9_000) }]),
      batch,
    )
    assert.equal(notes[0].level, 'warn')
    assert.ok(notes[0].note.length <= 240, `got ${notes[0].note.length}`)
  })

  it('drops the unusable entries and keeps the rest', () => {
    // Unlike a miscounted translation, which has to be refused: there every
    // later cue would land on the wrong timecode, and here nine good notes
    // would be thrown away over one bad one.
    const notes = parseReviewResponse(
      '[null,{"cue":"17","note":"not a number"},{"cue":19,"note":"   "},{"cue":18,"level":"error","note":"real"}]',
      batch,
    )
    assert.deepEqual(notes, [{ cue: 18, level: 'error', note: 'real' }])
  })

  it('refuses a reply that is not an array at all', () => {
    assert.throws(() => parseReviewResponse('nonsense', batch), TranslationFormatError)
    assert.throws(() => parseReviewResponse('{"cue":17}', batch), TranslationFormatError)
  })
})
