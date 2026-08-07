import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_QC, type Subtitle } from '../../lib/subtitles/types.ts'
import { finalSubs, reflowText, splitForVertical } from '../../lib/subtitles/layout.ts'
import { wordDiff } from '../../lib/subtitles/diff.ts'

const cue = (over: Partial<Subtitle> = {}): Subtitle => ({
  index: 1,
  start: '00:00:00,000',
  end: '00:00:04,000',
  text: 'Hola',
  ...over,
})

describe('reflowText', () => {
  it('collapses to one line when it fits', () => {
    assert.equal(reflowText('dos\nlíneas cortas', 42), 'dos líneas cortas')
    assert.equal(reflowText('  espacios   sobrantes  ', 42), 'espacios sobrantes')
  })

  it('never produces more than two lines', () => {
    // Two is the ceiling in every subtitling style guide, so the answer to text
    // that will not fit is another cue, never a third line.
    const text = 'Esta frase es claramente más larga que el límite y tiene que partirse en dos'
    for (const limit of [12, 20, 30, 42]) {
      assert.ok(reflowText(text, limit).split('\n').length <= 2, `límite ${limit}`)
    }
  })

  it('keeps both lines within the limit whenever the text can fit', () => {
    const out = reflowText('Esta frase cabe holgadamente partida en dos líneas', 30)
    for (const line of out.split('\n')) assert.ok(line.length <= 30, line)
  })

  it('overflows rather than inventing a third line when nothing fits', () => {
    // The documented escape hatch: qcIssues flags the long line, and the editor
    // splits the cue. Silently wrapping onto three lines would hide the problem.
    const out = reflowText('aaaa bbbb cccc dddd eeee ffff gggg', 18)
    assert.equal(out.split('\n').length, 2)
    assert.ok(out.split('\n').some(l => l.length > 18), out)
  })

  it('puts the shorter line on top when a break allows it', () => {
    const out = reflowText('Llegamos al puerto pero el barco ya había zarpado', 40)
    const [first, second] = out.split('\n')
    assert.ok(first.length <= second.length, `"${first}" / "${second}"`)
  })

  it('prefers breaking after punctuation', () => {
    const out = reflowText('Espera un momento, tengo que decirte algo', 25)
    assert.equal(out.split('\n')[0], 'Espera un momento,')
  })

  it('prefers breaking before a conjunction', () => {
    // Both candidate breaks fit at this limit, so the conjunction bonus decides.
    const out = reflowText('Llegamos al puerto pero el barco había zarpado', 32)
    assert.equal(out.split('\n')[1].startsWith('pero'), true, out)
  })

  it('returns a single over-long word whole', () => {
    // Hyphenating mid-word is wrong in subtitles; leave it for a human.
    const word = 'supercalifragilisticoespialidoso'
    assert.equal(reflowText(word, 10), word)
  })
})

describe('splitForVertical', () => {
  const narrow = { ...DEFAULT_QC, maxChars: 20, maxLines: 2 }

  it('passes short cues through, renumbered', () => {
    const out = splitForVertical(
      [cue({ index: 7, text: 'Corta' }), cue({ index: 9, text: 'Otra' })],
      narrow,
    )
    assert.deepEqual(
      out.map(s => s.index),
      [1, 2],
    )
    assert.deepEqual(
      out.map(s => s.text),
      ['Corta', 'Otra'],
    )
  })

  it('splits a cue too wide for the narrow layout', () => {
    const long = cue({ text: 'Una frase bastante más larga que veinte caracteres' })
    const out = splitForVertical([long], narrow)

    assert.equal(out.length, 2)
    assert.equal(out[0].start, long.start)
    assert.equal(out[1].end, long.end)
    // The halves meet in the middle of the cue's duration, leaving no gap.
    assert.equal(out[0].end, out[1].start)
    assert.equal(out[0].end, '00:00:02,000')
  })

  it('renumbers continuously across splits', () => {
    const out = splitForVertical(
      [cue({ text: 'Corta' }), cue({ text: 'Otra frase larguísima que no cabe de ninguna manera' })],
      narrow,
    )
    assert.deepEqual(
      out.map(s => s.index),
      [1, 2, 3],
    )
  })

  it('leaves everything alone in horizontal mode', () => {
    const subs = [cue({ text: 'x'.repeat(80) })]
    assert.deepEqual(finalSubs(subs, 'horizontal', narrow), subs)
    assert.equal(finalSubs(subs, 'vertical', narrow).length, 2)
  })
})

describe('wordDiff', () => {
  it('marks identical text as unchanged', () => {
    const ops = wordDiff('el gato duerme', 'el gato duerme')
    assert.deepEqual(
      ops.map(o => o.type),
      ['eq', 'eq', 'eq'],
    )
  })

  it('ignores capitalisation', () => {
    const ops = wordDiff('El Gato', 'el gato')
    assert.deepEqual(
      ops.map(o => o.type),
      ['eq', 'eq'],
    )
  })

  it('marks added and removed words', () => {
    const ops = wordDiff('el gato duerme', 'el gato negro duerme')
    assert.deepEqual(
      ops.map(o => `${o.type}:${o.val}`),
      ['eq:el', 'eq:gato', 'ins:negro', 'eq:duerme'],
    )

    const removed = wordDiff('el gato negro duerme', 'el gato duerme')
    assert.equal(
      removed.some(o => o.type === 'del' && o.val === 'negro'),
      true,
    )
  })

  it('returns nothing when there is no back-translation', () => {
    assert.deepEqual(wordDiff('el gato', ''), [])
  })

  it('degrades to plain text instead of stalling on huge inputs', () => {
    // 120 x 121 cells, over the ceiling.
    const big = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ')
    const ops = wordDiff(big, big + ' extra')
    assert.ok(ops.every(o => o.type === 'eq'))
    assert.equal(ops.length, 121)
  })
})
