import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { UnknownCueError, applyTextEdits, readCues } from '../../lib/subtitles/data.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * The one edit a client may make is to the words. Everything that lines
 * languages up — numbering, timings, cue counts — has to come out untouched,
 * because nothing downstream would notice if it did not.
 */

const cue = (index: number, text: string): Subtitle =>
  ({ index, start: `00:00:0${index},000`, end: `00:00:0${index},500`, text })

const source = [cue(1, 'one'), cue(2, 'two'), cue(3, 'three')]
const translations = {
  Spanish: [cue(1, 'uno'), cue(2, 'dos'), cue(3, 'tres')],
  French: [cue(1, 'un'), cue(2, 'deux'), cue(3, 'trois')],
}

describe('readCues', () => {
  it('reads what the editor saved', () => {
    const got = readCues({ subtitles: source, translations })
    assert.deepEqual(got, { subtitles: source, translations })
  })

  it('treats anything else as empty rather than trusting it', () => {
    assert.deepEqual(readCues({}), { subtitles: [], translations: {} })
    assert.deepEqual(readCues(null), { subtitles: [], translations: {} })
    assert.deepEqual(readCues({ subtitles: 'no', translations: [] }), { subtitles: [], translations: {} })
  })
})

describe('applyTextEdits', () => {
  it('changes the words of the named cue in the named language', () => {
    const got = applyTextEdits(source, translations, [
      { lang: 'Spanish', index: 2, text: 'DOS' },
      { lang: 'source', index: 3, text: 'THREE' },
    ])

    assert.equal(got.translations.Spanish[1].text, 'DOS')
    assert.equal(got.subtitles[2].text, 'THREE')
    // Timings and numbering are exactly what went in.
    assert.deepEqual(
      got.translations.Spanish.map(s => [s.index, s.start, s.end]),
      translations.Spanish.map(s => [s.index, s.start, s.end]),
    )
    assert.deepEqual(got.translations.French, translations.French, 'other languages untouched')
    assert.equal(got.translations.Spanish.length, 3)
  })

  it('leaves what it was given alone', () => {
    applyTextEdits(source, translations, [{ lang: 'Spanish', index: 1, text: 'x' }])
    assert.equal(translations.Spanish[0].text, 'uno')
    assert.equal(source[0].text, 'one')
  })

  it('refuses a cue or a language that is not there', () => {
    assert.throws(
      () => applyTextEdits(source, translations, [{ lang: 'Spanish', index: 9, text: 'x' }]),
      UnknownCueError,
    )
    assert.throws(
      () => applyTextEdits(source, translations, [{ lang: 'German', index: 1, text: 'x' }]),
      UnknownCueError,
    )
  })

  it('applies later edits on top of earlier ones', () => {
    const got = applyTextEdits(source, translations, [
      { lang: 'Spanish', index: 1, text: 'first' },
      { lang: 'Spanish', index: 1, text: 'second' },
    ])
    assert.equal(got.translations.Spanish[0].text, 'second')
  })
})
