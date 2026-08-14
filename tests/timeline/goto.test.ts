import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseGoto } from '../../lib/timeline/goto.ts'

/**
 * Reading what somebody typed into the palette.
 *
 * The failure that matters here is not rejecting nonsense — it is accepting
 * something and landing somewhere else. A timecode read as zero puts a
 * subtitler at the head of the reel with nothing on screen saying so.
 */
describe('parseGoto', () => {
  it('reads a bare number as a cue', () => {
    assert.deepEqual(parseGoto('42'), { kind: 'cue', index: 42 })
    assert.deepEqual(parseGoto('#42'), { kind: 'cue', index: 42 })
    assert.deepEqual(parseGoto('  7  '), { kind: 'cue', index: 7 })
  })

  it('has no cue zero to go to', () => {
    assert.equal(parseGoto('0'), null)
  })

  it('reads a clock, with or without the hour', () => {
    assert.deepEqual(parseGoto('1:23'), { kind: 'time', seconds: 83 })
    assert.deepEqual(parseGoto('00:01:23'), { kind: 'time', seconds: 83 })
    assert.deepEqual(parseGoto('1:00:00'), { kind: 'time', seconds: 3600 })
  })

  it('reads one digit after the comma as tenths', () => {
    assert.deepEqual(parseGoto('0:01,4'), { kind: 'time', seconds: 1.4 })
    assert.deepEqual(parseGoto('0:01.4'), { kind: 'time', seconds: 1.4 })
    assert.deepEqual(parseGoto('0:01,400'), { kind: 'time', seconds: 1.4 })
  })

  it('refuses a clock that no clock shows', () => {
    assert.equal(parseGoto('1:75'), null)
    assert.equal(parseGoto('1:99:00'), null)
  })

  it('treats ordinary words as no destination', () => {
    assert.equal(parseGoto(''), null)
    assert.equal(parseGoto('   '), null)
    assert.equal(parseGoto('hola'), null)
    assert.equal(parseGoto('12a'), null)
  })
})
