import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { useSubtitleStore } from '../../store/useSubtitleStore.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * Splitting and deleting, seen from the editor rather than from the cue list.
 *
 * The pure functions are tested next door; what matters here is that they are
 * applied to every language at once. A split that reaches the source and not
 * the Spanish leaves two tracks of different lengths whose numbers still line
 * up — the editor looks right on either tab, and the export is wrong from that
 * cue on.
 */

const cue = (index: number, start: string, end: string, text: string): Subtitle =>
  ({ index, start, end, text })

const source = [
  cue(1, '00:00:01,000', '00:00:05,000', 'one two three four'),
  cue(2, '00:00:06,000', '00:00:08,000', 'five six'),
]
const spanish = [
  cue(1, '00:00:01,000', '00:00:05,000', 'uno dos tres cuatro'),
  cue(2, '00:00:06,000', '00:00:08,000', 'cinco seis'),
]

const store = () => useSubtitleStore.getState()

beforeEach(() => {
  store().clearAll()
  store().loadSubtitles(source)
  store().setTranslation('Spanish', spanish)
  store().setBackTranslation('Spanish', spanish)
})

describe('splitSubtitle', () => {
  it('splits every language, not only the tab on screen', () => {
    store().splitSubtitle(1)

    assert.deepEqual(store().subtitles.map(s => s.text), ['one two', 'three four', 'five six'])
    assert.deepEqual(
      store().translations.Spanish.map(s => s.text),
      ['uno dos', 'tres cuatro', 'cinco seis'],
    )
    assert.deepEqual(store().translations.Spanish.map(s => s.index), [1, 2, 3])
  })

  it('drops back-translations, which are matched to the old numbering', () => {
    store().splitSubtitle(1)

    assert.deepEqual(store().backTranslations, {})
  })

  it('is one undo step, marked by itself', () => {
    store().splitSubtitle(1)
    assert.equal(store().subtitles.length, 3)

    store().undo()

    assert.equal(store().subtitles.length, 2)
    assert.equal(store().translations.Spanish.length, 2)
  })
})

describe('deleteSubtitle', () => {
  it('removes the cue from every language and renumbers', () => {
    store().deleteSubtitle(1)

    assert.deepEqual(store().subtitles.map(s => s.text), ['five six'])
    assert.deepEqual(store().translations.Spanish.map(s => s.text), ['cinco seis'])
    assert.deepEqual(store().translations.Spanish.map(s => s.index), [1])
  })

  it('comes back with undo, in every language', () => {
    store().deleteSubtitle(1)
    store().undo()

    assert.equal(store().subtitles.length, 2)
    assert.deepEqual(
      store().translations.Spanish.map(s => s.text),
      ['uno dos tres cuatro', 'cinco seis'],
    )
  })
})
