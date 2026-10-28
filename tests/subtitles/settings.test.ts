import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cuesFromWords, type TimedWord } from '../../lib/subtitles/cues.ts'
import { reflowText } from '../../lib/subtitles/layout.ts'
import { DEFAULT_SETTINGS, qcFor, readSettings } from '../../lib/subtitles/settings.ts'

describe('readSettings', () => {
  it('takes what is valid from stored jsonb or a request body', () => {
    assert.deepEqual(readSettings({ outputMode: 'vertical', maxLines: 1, maxChars: 37, sdh: true }),
      { outputMode: 'vertical', maxLines: 1, maxChars: 37, sdh: true })
  })

  it('puts anything odd back to its default rather than trusting it', () => {
    // `data` is free-form jsonb and a request body is the browser's to write:
    // a line length of 4000 would let a translation ask the model for essays.
    assert.deepEqual(readSettings({ outputMode: 'diagonal', maxLines: 3, maxChars: 4000, sdh: 'yes' }), DEFAULT_SETTINGS)
    assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS)
    assert.equal(readSettings({ maxChars: 37.5 }).maxChars, null)
    assert.equal(readSettings({ maxChars: null }).maxChars, null)
  })
})

describe('qcFor', () => {
  it('takes the orientation’s own line length unless one is set', () => {
    assert.equal(qcFor(DEFAULT_SETTINGS).maxChars, 42)
    assert.equal(qcFor({ ...DEFAULT_SETTINGS, outputMode: 'vertical' }).maxChars, 32)
    assert.equal(qcFor({ ...DEFAULT_SETTINGS, maxChars: 37 }).maxChars, 37)
    assert.equal(qcFor({ ...DEFAULT_SETTINGS, maxLines: 1 }).maxLines, 1)
  })
})

describe('reflowText on one line', () => {
  it('never breaks a one-line subtitle in two, however long', () => {
    const long = 'Bienvenidos a la bodega de la familia, donde elaboramos el vino'
    assert.ok(reflowText(long, 42).includes('\n'))
    assert.equal(reflowText(long, 42, 1), long)
  })
})

describe('cuesFromWords with speakers labelled', () => {
  const w = (text: string, start: number, speakerId: string): TimedWord => ({ text, start, end: start + 0.3, speakerId })
  const words = [w('Hola.', 0, 'a'), w('¿Qué', 0.4, 'b'), w('tal?', 0.7, 'b'), w('Bien.', 1.2, 'a')]

  it('names a voice where it starts speaking, numbered as first heard', () => {
    const cues = cuesFromWords(words, undefined, undefined, n => `(HABLANTE ${n})`)
    assert.deepEqual(cues.map(c => c.text), ['(HABLANTE 1) Hola.', '(HABLANTE 2) ¿Qué tal?', '(HABLANTE 1) Bien.'])
  })

  it('says nothing about who speaks when only one voice does, or when not asked', () => {
    const one = words.map(x => ({ ...x, speakerId: 'a' }))
    assert.ok(cuesFromWords(one, undefined, undefined, n => `(HABLANTE ${n})`).every(c => !c.text.includes('HABLANTE')))
    assert.ok(cuesFromWords(words).every(c => !c.text.includes('HABLANTE')))
  })
})
