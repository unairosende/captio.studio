import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  LIMITS,
  REPLY_SCHEMA,
  ReplyFormatError,
  glossaryFor,
  instructionsFor,
  projectTerms,
  readReply,
  type Brief,
} from '../../lib/assistant/reply.ts'

const plan = (over: Record<string, unknown> = {}) => ({
  projectName: 'Entrevista',
  sourceLanguage: 'Spanish',
  sequences: [
    { name: 'Entrevista · Horizontal', format: 'horizontal', targetLanguages: ['English', 'French'] },
    { name: 'Entrevista · Vertical', format: 'vertical', targetLanguages: ['English', 'French'] },
  ],
  ...over,
})

const brief = (over: Record<string, unknown> = {}) => ({
  sourceLanguage: 'Spanish',
  instructions: 'Tono cercano.',
  perLanguage: [{ language: 'French', instructions: 'Vouvoiement.' }],
  glossary: [
    { term: 'Captio', language: 'all', translation: '' },
    { term: 'TAC', language: 'English', translation: 'CT scan' },
  ],
  ...over,
})

describe('what the assistant may answer', () => {
  it('passes a well-formed plan through', () => {
    const r = readReply({ message: 'Dos secuencias.', questions: [], plan: plan(), brief: null }, 'scope')
    assert.equal(r.plan?.sequences.length, 2)
    assert.deepEqual(r.plan?.sequences[1], {
      name: 'Entrevista · Vertical', format: 'vertical', targetLanguages: ['English', 'French'],
    })
  })

  it('never offers a plan once the project exists, nor a brief before the material is read', () => {
    assert.equal(readReply({ message: 'x', questions: [], plan: plan(), brief: brief() }, 'review').plan, null)
    assert.equal(readReply({ message: 'x', questions: [], plan: plan(), brief: brief() }, 'scope').brief, null)
  })

  it('drops languages Captio cannot translate into, duplicates, and the source itself', () => {
    const r = readReply(
      {
        message: '',
        questions: [],
        plan: plan({
          sequences: [{ name: 'H', format: 'horizontal', targetLanguages: ['English', 'Klingon', 'English', 'Spanish'] }],
        }),
        brief: null,
      },
      'scope',
    )
    assert.deepEqual(r.plan?.sequences[0].targetLanguages, ['English'])
  })

  it('keeps no more sequences than a project should be set up with', () => {
    const many = Array.from({ length: 9 }, () => ({ name: 'H', format: 'horizontal', targetLanguages: [] }))
    const r = readReply({ message: 'x', questions: [], plan: plan({ sequences: many }), brief: null }, 'scope')
    assert.equal(r.plan?.sequences.length, LIMITS.sequences)
  })

  it('names what the model left unnamed, and refuses a plan that creates nothing', () => {
    const named = readReply(
      { message: 'x', questions: [], plan: plan({ sequences: [{ name: ' ', format: 'vertical', targetLanguages: [] }] }), brief: null },
      'scope',
    )
    assert.equal(named.plan?.sequences[0].name, 'Entrevista · Vertical')

    const nothing = readReply(
      { message: 'x', questions: [], plan: plan({ sequences: [{ name: 'H', format: 'square', targetLanguages: [] }] }), brief: null },
      'scope',
    )
    assert.equal(nothing.plan, null)
  })

  it('clamps what runs long rather than refusing it', () => {
    const r = readReply(
      { message: 'a'.repeat(5_000), questions: Array.from({ length: 9 }, (_, i) => `¿${i}?`), plan: null, brief: null },
      'scope',
    )
    assert.equal(r.message.length, LIMITS.message)
    assert.equal(r.questions.length, LIMITS.questions)
  })

  it('refuses a reply with nothing in it', () => {
    assert.throws(() => readReply({ message: ' ', questions: [], plan: null, brief: null }, 'scope'), ReplyFormatError)
    assert.throws(() => readReply('texto suelto', 'scope'), ReplyFormatError)
  })

  it('keeps one set of rules per language, and only terms with a language Captio knows', () => {
    const r = readReply(
      {
        message: '',
        questions: [],
        plan: null,
        brief: brief({
          perLanguage: [
            { language: 'French', instructions: 'Vouvoiement.' },
            { language: 'French', instructions: 'Tutoiement.' },
            { language: 'Klingon', instructions: 'Qapla’.' },
          ],
          glossary: [
            { term: 'Captio', language: 'all', translation: '' },
            { term: 'Nadie', language: 'Elvish', translation: 'x' },
            { term: ' ', language: 'all', translation: '' },
          ],
        }),
      },
      'review',
    )
    assert.deepEqual(r.brief?.perLanguage, [{ language: 'French', instructions: 'Vouvoiement.' }])
    assert.deepEqual(r.brief?.glossary, [{ term: 'Captio', language: 'all', translation: '' }])
  })
})

describe('the brief, as each translation receives it', () => {
  const b = readReply({ message: '', questions: [], plan: null, brief: brief() }, 'review').brief as Brief

  it('gives a language the general rules and its own', () => {
    assert.equal(instructionsFor(b, 'French'), 'Tono cercano.\nFrench: Vouvoiement.')
    assert.equal(instructionsFor(b, 'German'), 'Tono cercano.')
  })

  it('gives a language the terms for everyone and its own renderings, no one else’s', () => {
    assert.deepEqual(glossaryFor(b, 'English'), [{ term: 'Captio' }, { term: 'TAC', translation: 'CT scan' }])
    assert.deepEqual(glossaryFor(b, 'French'), [{ term: 'Captio' }])
  })

  it('keeps on the project only what holds in every language', () => {
    assert.deepEqual(projectTerms(b), [{ term: 'Captio' }])
  })

  it('fits what the translation prompt will accept', () => {
    // lib/ai/prompt.ts clamps the instructions it is given at 2,000 characters.
    const long = readReply(
      {
        message: '',
        questions: [],
        plan: null,
        brief: brief({
          instructions: 'x'.repeat(9_000),
          perLanguage: [{ language: 'French', instructions: 'y'.repeat(9_000) }],
        }),
      },
      'review',
    ).brief as Brief
    assert.ok(instructionsFor(long, 'French').length <= 2_000)
  })
})

describe('the schema the API holds the reply to', () => {
  // Structured outputs require every object to list all of its properties as
  // required and to allow nothing else. One forgotten object makes the API
  // refuse the request outright.
  function objects(node: unknown, path = 'reply'): [string, Record<string, unknown>][] {
    if (!node || typeof node !== 'object') return []
    const n = node as Record<string, unknown>
    const own: [string, Record<string, unknown>][] = n.type === 'object' ? [[path, n]] : []
    return [
      ...own,
      ...Object.entries(n).flatMap(([k, v]) =>
        Array.isArray(v) ? v.flatMap((x, i) => objects(x, `${path}.${k}[${i}]`)) : objects(v, `${path}.${k}`),
      ),
    ]
  }

  it('closes every object and requires all of its properties', () => {
    const found = objects(REPLY_SCHEMA)
    assert.ok(found.length >= 5, `found ${found.length} objects`)
    for (const [path, o] of found) {
      assert.equal(o.additionalProperties, false, `${path} allows more`)
      assert.deepEqual(
        [...(o.required as string[])].sort(),
        Object.keys(o.properties as object).sort(),
        `${path} leaves something optional`,
      )
    }
  })
})
