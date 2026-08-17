import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { useSubtitleStore } from '../../store/useSubtitleStore.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * What the glossary belongs to.
 *
 * It is terminology for a job, not for a file — and since migration 0007 the job
 * is the project, not the track. So it has to survive three things that all look
 * like "starting again": importing a corrected export, emptying the editor, and
 * moving to the next reel. It must not survive the fourth: opening a different
 * project, whose vocabulary is somebody else's.
 *
 * Every one of these is silent when wrong. Nothing errors; the translation
 * simply comes back using the wrong words.
 */

const cue = (index: number): Subtitle => ({
  index,
  start: '00:00:01,000',
  end: '00:00:03,000',
  text: `line ${index}`,
})

const store = () => useSubtitleStore.getState()

const TERMS = [{ term: 'Movistar' }, { term: 'Hacienda', translation: 'Tax Office' }]
const project = { id: 'proj_1', name: 'La película', glossary: TERMS }

beforeEach(() => {
  store().newSequence(project)
})

describe('the glossary', () => {
  it('arrives with the project rather than being typed in again', () => {
    assert.deepEqual(store().glossary, TERMS)
  })

  it('survives loading another subtitle file into the same sequence', () => {
    store().loadSubtitles([cue(1)])

    assert.equal(store().glossary.length, 2)
  })

  it('survives emptying the editor', () => {
    store().clearAll()

    assert.equal(store().glossary.length, 2)
  })

  it('follows into the next sequence of the same project', () => {
    // The whole reason projects exist: reel two must translate the character's
    // name exactly as reel one did, without anybody re-typing it.
    store().newSequence(project)

    assert.deepEqual(store().glossary, TERMS)
  })

  it('does not follow into a different project', () => {
    store().newSequence({ id: 'proj_2', name: 'Otro cliente', glossary: [] })

    assert.deepEqual(store().glossary, [])
  })

  it('comes back with the project a sequence belongs to', () => {
    store().openSequence({
      id: 's1',
      name: 'Bobina 3',
      version: 4,
      subtitles: [cue(1)],
      translations: {},
      projectId: 'proj_9',
      projectName: 'Serie',
      glossary: [{ term: 'Nautilus' }],
    })
    assert.deepEqual(store().glossary, [{ term: 'Nautilus' }])
    assert.equal(store().projectId, 'proj_9')

    // A project with no terms in it yet: empty, and no crash.
    store().openSequence({
      id: 's2',
      name: 'Old',
      version: 1,
      subtitles: [],
      translations: {},
      projectId: 'proj_9',
      projectName: 'Serie',
    })
    assert.deepEqual(store().glossary, [])
  })

  it('marks the work unsaved, since it changes what the next translation says', () => {
    store().markSaved('s1', 'Bobina 3', 4)
    store().setGlossary([{ term: 'Nautilus' }])

    assert.equal(store().dirty, true)
  })

  it('remembers that the terms themselves need writing back', () => {
    // Tracked apart from `dirty` because the terms live on a different row from
    // the cues. Without this the editor would either never save them, or write
    // its local copy back on every save and quietly undo a term a colleague
    // added while it was open.
    store().markSaved('s1', 'Bobina 3', 4)
    assert.equal(store().glossaryDirty, false)

    store().setGlossary([{ term: 'Nautilus' }])
    assert.equal(store().glossaryDirty, true)

    store().markSaved('s1', 'Bobina 3', 5)
    assert.equal(store().glossaryDirty, false)
  })
})
