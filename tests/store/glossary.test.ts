import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { useSubtitleStore } from '../../store/useSubtitleStore.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * What the glossary belongs to.
 *
 * It is terminology for a job, not for a file: importing a corrected export
 * into the same project must not cost somebody the terms they agreed with the
 * client, and opening a different project must not carry the last one's
 * vocabulary into it. Both are silent when wrong — the translation simply comes
 * back using the wrong words.
 */

const cue = (index: number): Subtitle => ({
  index,
  start: '00:00:01,000',
  end: '00:00:03,000',
  text: `line ${index}`,
})

const store = () => useSubtitleStore.getState()

beforeEach(() => {
  store().newProject()
  store().setGlossary([{ term: 'Movistar' }, { term: 'Hacienda', translation: 'Tax Office' }])
})

describe('the glossary', () => {
  it('survives loading another subtitle file into the same project', () => {
    store().loadSubtitles([cue(1)])

    assert.equal(store().glossary.length, 2)
  })

  it('survives emptying the editor', () => {
    store().clearAll()

    assert.equal(store().glossary.length, 2)
  })

  it('does not follow into a new project', () => {
    store().newProject()

    assert.deepEqual(store().glossary, [])
  })

  it('comes back with the project it was saved in', () => {
    store().openProject({
      id: 'p1',
      name: 'Episode 3',
      version: 4,
      subtitles: [cue(1)],
      translations: {},
      glossary: [{ term: 'Nautilus' }],
    })
    assert.deepEqual(store().glossary, [{ term: 'Nautilus' }])

    // Saved before the glossary existed: no terms, and no crash.
    store().openProject({ id: 'p2', name: 'Old', version: 1, subtitles: [], translations: {} })
    assert.deepEqual(store().glossary, [])
  })

  it('marks the project unsaved, since it changes what the next translation says', () => {
    store().markSaved('p1', 'Episode 3', 4)
    store().setGlossary([{ term: 'Nautilus' }])

    assert.equal(store().dirty, true)
  })
})
