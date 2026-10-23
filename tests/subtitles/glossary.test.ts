import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addVariant, compileVariants, keyterms, mergeGlossaries } from '../../lib/subtitles/glossary.ts'

describe('filing a misspelling under its term', () => {
  it('adds it to the entry that already writes the term', () => {
    assert.deepEqual(addVariant([{ term: 'Captio', translation: 'Captio', variants: ['Kaptio'] }], 'captio', 'Capccio'), [
      { term: 'Captio', translation: 'Captio', variants: ['Kaptio', 'Capccio'] },
    ])
  })

  it('opens a new entry when none does, and does not list a variant twice', () => {
    assert.deepEqual(addVariant([], 'Keweke', 'Cuaco'), [{ term: 'Keweke', variants: ['Cuaco'] }])
    assert.deepEqual(addVariant([{ term: 'Keweke', variants: ['Cuaco'] }], 'Keweke', 'cuaco'), [
      { term: 'Keweke', variants: ['Cuaco'] },
    ])
  })
})

describe('the project and client glossaries together', () => {
  it('keeps the project’s entry where both name a term, and adds the rest', () => {
    const merged = mergeGlossaries(
      [{ term: 'Captio', translation: 'Captio Pro' }],
      [{ term: ' captio ', translation: 'Captio' }, { term: 'Keweke' }],
    )
    assert.deepEqual(merged, [{ term: 'Captio', translation: 'Captio Pro' }, { term: 'Keweke' }])
  })

  it('lets the project win a variant both claim', () => {
    const respell = compileVariants(
      mergeGlossaries([{ term: 'Captio Pro', variants: ['Capccio'] }], [{ term: 'Captio', variants: ['Capccio'] }]),
    )
    assert.equal(respell('Capccio'), 'Captio Pro')
  })

  it('is either list alone when the other is empty', () => {
    assert.deepEqual(mergeGlossaries([], [{ term: 'Keweke' }]), [{ term: 'Keweke' }])
    assert.deepEqual(mergeGlossaries([{ term: 'Keweke' }]), [{ term: 'Keweke' }])
  })
})

describe('respelling the glossary variants', () => {
  const respell = compileVariants([
    { term: 'Captio', variants: ['Capccio', 'Kaptio'] },
    { term: 'Captio Studio', variants: ['capccio studio'] },
    { term: 'I+D', variants: ['R+D'] },
    { term: 'Ñoño', variants: ['nono'] },
  ])

  it('writes the term whatever case the recogniser chose', () => {
    assert.equal(respell('capccio lo subtitula. Kaptio también.'), 'Captio lo subtitula. Captio también.')
  })

  it('touches whole words only', () => {
    assert.equal(respell('Capccios y nonos'), 'Capccios y nonos')
  })

  it('prefers the longest variant, and finds one split across lines', () => {
    assert.equal(respell('Esto es Capccio\nStudio.'), 'Esto es Captio Studio.')
  })

  it('reads a variant literally, not as a pattern', () => {
    assert.equal(respell('el R+D de la casa'), 'el I+D de la casa')
    assert.equal(respell('el RRD de la casa'), 'el RRD de la casa')
  })

  it('finds a variant next to a non-ASCII letter boundary', () => {
    assert.equal(respell('«nono», dijo'), '«Ñoño», dijo')
  })

  it('never rewrites a term it has just written', () => {
    const chain = compileVariants([
      { term: 'Captio', variants: ['Kaptio'] },
      { term: 'CAPTIO', variants: ['Captio'] },
    ])
    assert.equal(chain('Kaptio'), 'Captio')
  })

  it('is the identity when nothing has variants', () => {
    assert.equal(compileVariants([{ term: 'Captio' }])('Capccio'), 'Capccio')
    assert.equal(compileVariants()('Capccio'), 'Capccio')
  })
})

describe('the glossary as Scribe keyterms', () => {
  it('sends the terms, never translations or variants', () => {
    assert.deepEqual(
      keyterms([
        { term: ' Captio ', variants: ['Capccio'] },
        { term: 'Reserva de la Familia' },
        { term: 'Captio' },
        { term: '' },
      ]),
      ['Captio', 'Reserva de la Familia'],
    )
  })

  it('leaves out what Scribe would refuse', () => {
    assert.deepEqual(
      keyterms([
        { term: 'x'.repeat(50) },
        { term: 'uno dos tres cuatro cinco seis' },
        { term: 'a <b>' },
        { term: 'back\\slash' },
        { term: 'x'.repeat(49) },
      ]),
      ['x'.repeat(49)],
    )
  })
})
