import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  correctedTranslations,
  recall,
  substitutions,
  suggestVariants,
  suggestionKey,
} from '../../lib/subtitles/corrections.ts'

const cue = (index: number, text: string, machine?: string) => ({
  index,
  start: '00:00:00,000',
  end: '00:00:01,000',
  text,
  ...(machine === undefined ? {} : { machine }),
})

describe('what a person put in place of what the machine wrote', () => {
  it('pairs the words taken out with the words put in', () => {
    assert.deepEqual(substitutions('Hoy con Capccio, en directo', 'Hoy con Captio, en directo'), [
      { from: 'Capccio', to: 'Captio' },
    ])
  })

  it('reads a name the recogniser split in two', () => {
    assert.deepEqual(substitutions('lo hace Cap tío solo', 'lo hace Captio solo'), [{ from: 'Cap tío', to: 'Captio' }])
  })

  it('ignores cuts, additions, case and punctuation', () => {
    assert.deepEqual(substitutions('hoy con Captio y más', 'Hoy con Captio'), [])
    assert.deepEqual(substitutions('con Captio', 'con Captio, claro'), [])
    assert.deepEqual(substitutions('Captio.', 'Captio!'), [])
  })

  it('does not take a rewrite for a misspelling', () => {
    assert.deepEqual(substitutions('Hoy con Capccio y Keweke', 'Hoy con Captio'), [])
  })
})

describe('variants worth suggesting', () => {
  const cues = [
    cue(1, 'Captio subtitula', 'Capccio subtitula'),
    cue(2, 'y Captio traduce', 'y Capccio traduce'),
    cue(3, 'Captio Pro también', 'Capccio también'),
    cue(4, 'una vez Keweke', 'una vez Cuaco'),
    cue(5, 'importado a mano'),
    cue(6, 'sin tocar', 'sin tocar'),
  ]

  it('offers a correction made twice, the more frequent where it went two ways', () => {
    assert.deepEqual(suggestVariants(cues), [{ term: 'Captio', variant: 'Capccio', count: 2 }])
  })

  it('stays quiet about what the glossary already knows, or was dismissed', () => {
    assert.deepEqual(suggestVariants(cues, [{ term: 'Captio', variants: ['capccio'] }]), [])
    assert.deepEqual(suggestVariants(cues, [], [suggestionKey({ term: 'Captio', variant: 'Capccio' })]), [])
  })

  it('takes a single correction when asked for one', () => {
    assert.deepEqual(
      suggestVariants(cues, [], [], 1).map(s => s.term),
      ['Captio', 'Keweke'],
    )
  })
})

describe('the translation memory', () => {
  const subtitles = [cue(1, 'Bienvenidos a la bodega.'), cue(2, 'Reserva de la Familia'), cue(3, '__proto__')]

  it('remembers only the lines somebody corrected, keyed by what they translate', () => {
    const memory = correctedTranslations([
      {
        subtitles,
        translation: [
          cue(1, 'Welcome to the winery.', 'Welcome to the cellar.'),
          cue(2, 'Family Reserve', 'Family Reserve'),
          cue(3, 'proto', 'Proto'),
        ],
      },
    ])
    assert.equal(recall(memory, '  bienvenidos  a la\nbodega. '), 'Welcome to the winery.')
    assert.equal(recall(memory, 'Reserva de la Familia'), undefined)
    assert.equal(recall(memory, '__proto__'), 'proto')
    assert.equal(recall(memory, 'constructor'), undefined)
  })

  it('lets a later correction of the same line win', () => {
    const memory = correctedTranslations([
      { subtitles, translation: [cue(1, 'Welcome to the winery.', 'Welcome to the cellar.')] },
      { subtitles, translation: [cue(1, 'Welcome to our winery.', 'Welcome to the cellar.')] },
    ])
    assert.equal(recall(memory, 'Bienvenidos a la bodega.'), 'Welcome to our winery.')
  })
})
