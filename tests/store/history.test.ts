import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { useSubtitleStore } from '../../store/useSubtitleStore.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * Undo, exercised outside React.
 *
 * The store is the whole of it — the keyboard shortcut and the drag handler
 * only decide *when* an action is marked. What is worth pinning down is that a
 * marked action comes back exactly, that redo stops offering a future which can
 * no longer happen, and that undoing past the creation of a language does not
 * leave the editor pointing at a tab that is gone.
 */

const cue = (index: number, start: string, end: string, text = `line ${index}`): Subtitle => ({
  index,
  start,
  end,
  text,
})

const track = [cue(1, '00:00:01,000', '00:00:03,000'), cue(2, '00:00:05,000', '00:00:07,000')]

const store = () => useSubtitleStore.getState()

beforeEach(() => {
  useSubtitleStore.getState().clearAll()
  useSubtitleStore.getState().loadSubtitles(track)
})

describe('undo', () => {
  it('does nothing when there is nothing to undo', () => {
    // Pressing it on a freshly opened file must not empty the editor.
    store().undo()

    assert.equal(store().subtitles.length, 2)
  })

  it('takes back a retime', () => {
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:04,000')
    assert.equal(store().subtitles[0].start, '00:00:02,000')

    store().undo()

    assert.equal(store().subtitles[0].start, '00:00:01,000')
    assert.equal(store().subtitles[0].end, '00:00:03,000')
  })

  it('takes back a whole drag rather than one frame of it', () => {
    // A drag marks once and then retimes on every pointer move. If each move
    // were its own step, undo would crawl backwards through the gesture.
    store().pushUndo()
    for (const start of ['00:00:01,100', '00:00:01,200', '00:00:01,300', '00:00:02,500']) {
      store().retimeSubtitle(1, start, '00:00:03,000')
    }

    store().undo()

    assert.equal(store().subtitles[0].start, '00:00:01,000')
    assert.equal(store().past.length, 0, 'one gesture should leave one step')
  })

  it('steps back through several actions in order', () => {
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:03,000')
    store().pushUndo()
    store().retimeSubtitle(2, '00:00:06,000', '00:00:07,000')

    store().undo()
    assert.equal(store().subtitles[1].start, '00:00:05,000')
    assert.equal(store().subtitles[0].start, '00:00:02,000', 'the earlier change should remain')

    store().undo()
    assert.equal(store().subtitles[0].start, '00:00:01,000')
  })

  it('forgets its history when a different file is opened', () => {
    // Undoing into the previous job would paste one client's cues into another.
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:03,000')

    store().loadSubtitles([cue(1, '00:01:00,000', '00:01:02,000')])
    store().undo()

    assert.equal(store().subtitles.length, 1)
    assert.equal(store().subtitles[0].start, '00:01:00,000')
  })
})

describe('redo', () => {
  it('puts back what undo took away', () => {
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:04,000')
    store().undo()

    store().redo()

    assert.equal(store().subtitles[0].start, '00:00:02,000')
  })

  it('stops offering a future once a new action replaces it', () => {
    // Redo after an edit would paste work from a timeline that no longer
    // happened, on top of the one that did.
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:04,000')
    store().undo()

    store().pushUndo()
    store().retimeSubtitle(2, '00:00:06,000', '00:00:07,000')
    store().redo()

    assert.equal(store().subtitles[0].start, '00:00:01,000', 'the abandoned branch stayed gone')
    assert.equal(store().subtitles[1].start, '00:00:06,000', 'the real change survived')
  })
})

describe('the open tab', () => {
  it('falls back to the source when undo removes the language being viewed', () => {
    // Otherwise the editor renders a language that is no longer in the store:
    // nothing on screen, and no obvious way back.
    store().pushUndo()
    store().setTranslation('French', track)
    assert.equal(store().activeTab, 'French')

    store().undo()

    assert.equal(store().activeTab, 'source')
  })

  it('stays where it is when the language survives', () => {
    store().setTranslation('French', track)
    store().pushUndo()
    store().retimeSubtitle(1, '00:00:02,000', '00:00:03,000')

    store().undo()

    assert.equal(store().activeTab, 'French')
  })
})
