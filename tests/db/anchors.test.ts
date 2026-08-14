import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseAnchorOps } from '../../lib/db/comments.ts'

/**
 * What the save route will accept as a renumbering.
 *
 * These arrive from the browser and are applied straight to `cue_index`, so
 * this is the point where a hostile request body turns into an UPDATE. The
 * editor only ever moves cues one place at a time; anything else is either a
 * bug or somebody trying to scatter an organisation's notes in one request.
 */
describe('parseAnchorOps', () => {
  it('keeps the shifts the editor makes', () => {
    assert.deepEqual(
      parseAnchorOps([
        { fromIndex: 2, delta: 1 },
        { dropIndex: 4, fromIndex: 5, delta: -1 },
      ]),
      [
        { fromIndex: 2, delta: 1 },
        { dropIndex: 4, fromIndex: 5, delta: -1 },
      ],
    )
  })

  it('refuses a shift larger than one cue', () => {
    assert.deepEqual(parseAnchorOps([{ fromIndex: 1, delta: 9999 }]), [])
    assert.deepEqual(parseAnchorOps([{ fromIndex: 1, delta: 0 }]), [])
  })

  it('refuses anything that is not a pair of integers', () => {
    assert.deepEqual(parseAnchorOps([{ fromIndex: '1', delta: 1 }]), [])
    assert.deepEqual(parseAnchorOps([{ fromIndex: 1.5, delta: 1 }]), [])
    assert.deepEqual(parseAnchorOps([{ delta: 1 }]), [])
    assert.deepEqual(parseAnchorOps([null, 'x', 7]), [])
  })

  it('drops a nonsense dropIndex rather than the whole shift', () => {
    assert.deepEqual(
      parseAnchorOps([{ dropIndex: 'all', fromIndex: 3, delta: -1 }]),
      [{ fromIndex: 3, delta: -1 }],
    )
  })

  it('treats a missing or non-list body as no renumbering at all', () => {
    assert.deepEqual(parseAnchorOps(undefined), [])
    assert.deepEqual(parseAnchorOps({ fromIndex: 1, delta: 1 }), [])
  })
})
