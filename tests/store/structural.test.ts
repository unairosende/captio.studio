import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { useSubtitleStore } from '../../store/useSubtitleStore.ts'
import type { ProjectComment } from '../../types/comment.ts'
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

/**
 * Comments point at a cue number, and cue numbers move.
 *
 * The cues live in a jsonb blob and the comments live in their own table, so
 * nothing in the database ties the two together — the editor has to say what it
 * renumbered, in the order it happened. Getting this wrong is quiet: every note
 * below the edit ends up quoting a line nobody wrote.
 */
describe('comment anchors', () => {
  const note = (id: string, cue: number): ProjectComment => ({
    id,
    cue_index: cue,
    lang: null,
    body: 'check this',
    author_id: 'user_a',
    author_name: 'A',
    resolved: false,
    created_at: '2026-01-01T00:00:00.000Z',
  })

  it('pushes everything below a split down one', () => {
    store().setComments([note('a', 1), note('b', 2)])
    store().splitSubtitle(1)

    assert.deepEqual(store().comments.map(c => c.cue_index), [1, 3])
    assert.deepEqual(store().anchorOps, [{ fromIndex: 2, delta: 1 }])
  })

  it('takes the deleted cue’s notes with it', () => {
    store().setComments([note('a', 1), note('b', 2)])
    store().deleteSubtitle(1)

    assert.deepEqual(store().comments.map(c => c.id), ['b'])
    assert.deepEqual(store().comments.map(c => c.cue_index), [1])
    assert.deepEqual(store().anchorOps, [{ dropIndex: 1, fromIndex: 2, delta: -1 }])
  })

  it('puts the numbering back on undo, and forward again on redo', () => {
    store().setComments([note('a', 1), note('b', 2)])

    store().splitSubtitle(1)
    assert.deepEqual(store().comments.map(c => c.cue_index), [1, 3])

    store().undo()
    assert.deepEqual(store().comments.map(c => c.cue_index), [1, 2])

    store().redo()
    assert.deepEqual(store().comments.map(c => c.cue_index), [1, 3])

    // Every step is sent, in the order it happened: the server replays them
    // rather than being handed a final answer it has no way to check.
    assert.deepEqual(store().anchorOps, [
      { fromIndex: 2, delta: 1 },
      { fromIndex: 2, delta: -1 },
      { fromIndex: 2, delta: 1 },
    ])
  })

  it('leaves nothing to replay once a save has carried it', () => {
    store().setComments([note('a', 2)])
    store().splitSubtitle(1)
    assert.equal(store().anchorOps.length, 1)

    store().markSaved('p1', 'Project', 2)

    assert.deepEqual(store().anchorOps, [])
    // The comment stays where the save put it.
    assert.deepEqual(store().comments.map(c => c.cue_index), [3])
  })

  it('records nothing for an edit that changes no numbering', () => {
    store().setComments([note('a', 1)])
    store().pushUndo()
    store().updateSubtitle('Spanish', 1, 'otra cosa')
    store().undo()

    assert.deepEqual(store().anchorOps, [])
    assert.deepEqual(store().comments.map(c => c.cue_index), [1])
  })
})
