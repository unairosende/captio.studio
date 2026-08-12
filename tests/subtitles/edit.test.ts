import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { deleteCue, splitCue } from '../../lib/subtitles/edit.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * Splitting and deleting are the two edits that change the shape of a track.
 *
 * Everything else — translation, back-translation, export, the timeline — lines
 * languages up by cue number, so a renumbering that comes out wrong does not
 * fail loudly: it quietly attaches the Spanish of cue 12 to the English of cue
 * 11 for the rest of the file.
 */

const cue = (index: number, start: string, end: string, text: string): Subtitle =>
  ({ index, start, end, text })

const track = [
  cue(1, '00:00:01,000', '00:00:05,000', 'one two three four'),
  cue(2, '00:00:06,000', '00:00:08,000', 'five six'),
]

describe('splitCue', () => {
  it('cuts at the midpoint when there is no playhead', () => {
    const [a, b] = splitCue(track, 1)

    assert.equal(a.end, '00:00:03,000')
    assert.equal(b.start, '00:00:03,000')
    assert.equal(a.text, 'one two')
    assert.equal(b.text, 'three four')
  })

  it('cuts at the playhead, and divides the words in the same proportion', () => {
    const [a, b] = splitCue(track, 1, 4)

    assert.equal(a.end, '00:00:04,000')
    assert.equal(b.start, '00:00:04,000')
    // Three quarters of the way through: three words above, one below.
    assert.equal(a.text, 'one two three')
    assert.equal(b.text, 'four')
  })

  it('ignores a playhead outside the cue, which would make a cue of no length', () => {
    const outside = splitCue(track, 1, 30)
    assert.equal(outside[0].end, '00:00:03,000')

    const onTheBoundary = splitCue(track, 1, 1)
    assert.equal(onTheBoundary[0].end, '00:00:03,000')
  })

  it('renumbers everything after the split', () => {
    const split = splitCue(track, 1)

    assert.deepEqual(split.map(s => s.index), [1, 2, 3])
    assert.equal(split[2].text, 'five six')
    assert.equal(split[2].start, '00:00:06,000')
  })

  it('keeps the only word in the first half rather than repeating it', () => {
    const [a, b] = splitCue([cue(1, '00:00:01,000', '00:00:03,000', 'sí')], 1)

    assert.equal(a.text, 'sí')
    assert.equal(b.text, '')
  })

  it('leaves the track alone when the cue is not there', () => {
    assert.equal(splitCue(track, 99), track)
  })
})

describe('deleteCue', () => {
  it('removes the cue and closes the gap in the numbering', () => {
    const left = deleteCue([...track, cue(3, '00:00:09,000', '00:00:11,000', 'seven')], 2)

    assert.deepEqual(left.map(s => s.index), [1, 2])
    assert.deepEqual(left.map(s => s.text), ['one two three four', 'seven'])
  })

  it('leaves the track alone when the cue is not there', () => {
    assert.equal(deleteCue(track, 99), track)
  })
})
