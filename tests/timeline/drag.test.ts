import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { srtToSec } from '../../lib/subtitles/timecode.ts'
import type { Subtitle } from '../../lib/subtitles/types.ts'
import { hitTest, moveEdge, moveWhole } from '../../lib/timeline/drag.ts'

/**
 * What a drag is allowed to produce.
 *
 * Every failure here ships. An inverted cue, or one overlapping the next, looks
 * fine in the editor and then stacks or disappears in the player — found by the
 * client, after delivery.
 */

const cue = (index: number, start: string, end: string): Subtitle => ({
  index,
  start,
  end,
  text: `line ${index}`,
})

const track = [
  cue(1, '00:00:01,000', '00:00:03,000'),
  cue(2, '00:00:05,000', '00:00:07,000'),
  cue(3, '00:00:09,000', '00:00:11,000'),
]

/** 1000px showing 0–20s, so one second is 50px. */
const view = { start: 0, span: 20 }
const band = { top: 18, height: 38 }

describe('what is under the pointer', () => {
  it('finds the body of a cue', () => {
    assert.deepEqual(hitTest(track, 100, 30, 1000, view, band), { index: 0, edge: 'body' })
  })

  it('finds each edge, and prefers them to the body', () => {
    // 1s is at 50px, 3s at 150px.
    assert.deepEqual(hitTest(track, 50, 30, 1000, view, band), { index: 0, edge: 'start' })
    assert.deepEqual(hitTest(track, 150, 30, 1000, view, band), { index: 0, edge: 'end' })
  })

  it('ignores anything outside the cue band', () => {
    // Above is the ruler, below is the waveform. Clicking those seeks, and
    // seeking must never turn into an accidental retime.
    assert.equal(hitTest(track, 100, 5, 1000, view, band), null)
    assert.equal(hitTest(track, 100, 100, 1000, view, band), null)
  })

  it('reports nothing in the gaps between cues', () => {
    assert.equal(hitTest(track, 220, 30, 1000, view, band), null)
  })
})

describe('dragging an edge', () => {
  it('moves the start where asked', () => {
    const out = moveEdge(track, 1, 'start', 4.2)

    assert.equal(out?.start, '00:00:04,200')
    assert.equal(out?.end, '00:00:07,000', 'the far edge should not move')
  })

  it('will not drag a start past its own end', () => {
    // Inverted cues are rendered by nothing, and some parsers reject the file.
    const out = moveEdge(track, 1, 'start', 99)

    assert.ok(srtToSec(out!.start) < srtToSec(out!.end))
  })

  it('will not drag a start over the previous cue', () => {
    const out = moveEdge(track, 1, 'start', 0)

    assert.ok(
      srtToSec(out!.start) >= srtToSec(track[0].end),
      `${out!.start} overlaps ${track[0].end}`,
    )
  })

  it('will not drag an end over the next cue', () => {
    const out = moveEdge(track, 1, 'end', 99)

    assert.ok(srtToSec(out!.end) <= srtToSec(track[2].start))
  })

  it('lets the last cue run to the end of the audio, and no further', () => {
    const out = moveEdge(track, 2, 'end', 99, { duration: 30 })

    assert.equal(out?.end, '00:00:30,000')
  })

  it('allows a cue shorter than the quality threshold', () => {
    // Length is a warning, not a wall. Refusing here would be arguing with
    // somebody about something the checks already flag.
    const out = moveEdge(track, 1, 'start', 6.9)

    assert.ok(srtToSec(out!.end) - srtToSec(out!.start) < 0.83)
    assert.ok(srtToSec(out!.end) > srtToSec(out!.start))
  })

  it('snaps to a frame', () => {
    // 25fps: 40ms boundaries. Anything in between drifts on re-import.
    const out = moveEdge(track, 1, 'start', 4.237)
    const frames = srtToSec(out!.start) * 25

    assert.ok(Math.abs(frames - Math.round(frames)) < 1e-6)
  })

  it('answers nothing for a cue that is not there', () => {
    assert.equal(moveEdge(track, 99, 'start', 1), null)
  })
})

describe('sliding a whole cue', () => {
  it('keeps its length', () => {
    const out = moveWhole(track, 1, 0.5)

    assert.equal(srtToSec(out!.end) - srtToSec(out!.start), 2)
  })

  it('keeps its length even when a neighbour stops it early', () => {
    // The tempting bug is to clamp the start and leave the end where it was,
    // silently shortening a cue nobody meant to resize.
    const out = moveWhole(track, 1, -99)

    assert.equal(srtToSec(out!.start), 3, 'should come to rest against the previous cue')
    assert.equal(srtToSec(out!.end) - srtToSec(out!.start), 2)
  })

  it('does not push past the following cue', () => {
    const out = moveWhole(track, 1, 99)

    assert.ok(srtToSec(out!.end) <= srtToSec(track[2].start))
    assert.equal(srtToSec(out!.end) - srtToSec(out!.start), 2)
  })

  it('never slides before zero', () => {
    const out = moveWhole(track, 0, -99)

    assert.equal(out?.start, '00:00:00,000')
    assert.equal(srtToSec(out!.end) - srtToSec(out!.start), 2)
  })
})
