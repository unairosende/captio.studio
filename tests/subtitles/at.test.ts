import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cueAt } from '../../lib/subtitles/at.ts'

const cues = [
  { index: 1, start: '00:00:01,000', end: '00:00:02,000', text: 'one' },
  { index: 2, start: '00:00:02,000', end: '00:00:03,500', text: 'two' },
  { index: 3, start: '00:00:03,000', end: '00:00:04,000', text: 'three (overlaps two)' },
]

describe('the cue under the picture', () => {
  it('is null before, between and after', () => {
    assert.equal(cueAt(cues, 0.5), null)
    assert.equal(cueAt(cues, 4.0), null)
    assert.equal(cueAt([], 1.5), null)
  })

  it('treats the end as exclusive, so a boundary has one answer', () => {
    assert.equal(cueAt(cues, 1.0)?.index, 1)
    assert.equal(cueAt(cues, 1.999)?.index, 1)
    assert.equal(cueAt(cues, 2.0)?.index, 2)
  })

  it('resolves an overlap to the cue that started first', () => {
    assert.equal(cueAt(cues, 3.2)?.index, 2)
    assert.equal(cueAt(cues, 3.6)?.index, 3)
  })
})
