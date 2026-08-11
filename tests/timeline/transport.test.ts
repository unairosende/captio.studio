import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_SPEED,
  REPEAT_WINDOW_MS,
  nextTransport,
  speedLabel,
} from '../../lib/timeline/transport.ts'

/**
 * The speed ladder behind J and L.
 *
 * Muscle memory is the point, so the failures worth catching are the ones where
 * the transport does something the hands did not ask for: not accelerating on a
 * quick double press, or flying off at 8x because of a press two minutes ago.
 */

describe('pressing L or J', () => {
  it('starts at normal speed', () => {
    assert.deepEqual(nextTransport(null, 1, 1_000), { direction: 1, speed: 1, at: 1_000 })
  })

  it('doubles on a quick repeat', () => {
    let t = nextTransport(null, 1, 0)
    t = nextTransport(t, 1, 100)
    assert.equal(t.speed, 2)

    t = nextTransport(t, 1, 200)
    assert.equal(t.speed, 4)
  })

  it('starts over when the presses are far apart', () => {
    // Coming back to the keyboard after a while and pressing L should play,
    // not resume at whatever speed was left behind earlier.
    const first = nextTransport(null, 1, 0)
    const second = nextTransport(first, 1, REPEAT_WINDOW_MS + 1)

    assert.equal(second.speed, 1)
  })

  it('drops back to normal when the direction reverses', () => {
    // Running forward at 4x and pressing J means "go back and look at that",
    // not "fly backwards past it at 4x".
    let t = nextTransport(null, 1, 0)
    t = nextTransport(t, 1, 50)
    t = nextTransport(t, 1, 100)
    assert.equal(t.speed, 4)

    assert.equal(nextTransport(t, -1, 120).speed, 1)
  })

  it('stops doubling at the ceiling', () => {
    let t = nextTransport(null, 1, 0)
    for (let i = 1; i <= 12; i++) t = nextTransport(t, 1, i * 50)

    assert.equal(t.speed, MAX_SPEED)
  })
})

describe('the speed readout', () => {
  it('reads as whole numbers', () => {
    assert.equal(speedLabel({ direction: 1, speed: 1, at: 0 }), '1×')
    assert.equal(speedLabel({ direction: 1, speed: 8, at: 0 }), '8×')
  })

  it('shows that reverse is reverse', () => {
    assert.equal(speedLabel({ direction: -1, speed: 4, at: 0 }), '−4×')
  })

  it('has something to say before anything has been pressed', () => {
    assert.equal(speedLabel(null), '1×')
  })
})
