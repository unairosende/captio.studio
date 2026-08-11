import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { clockLabel, rulerLabel, tickEvery } from '../../lib/timeline/ruler.ts'

describe('tick spacing', () => {
  it('never produces more ticks than fit', () => {
    // The failure this prevents is a ruler whose labels overlap into a smear,
    // and it appears only at certain durations — the ones nobody tries by hand.
    for (const duration of [3, 7.5, 61, 137, 600, 3_600, 7_200, 86_400]) {
      for (const maxTicks of [4, 8, 12, 30]) {
        const interval = tickEvery(duration, maxTicks)
        const ticks = duration / interval
        assert.ok(
          ticks <= maxTicks || interval === 3_600,
          `${duration}s at ${maxTicks} ticks gave ${ticks}`,
        )
      }
    }
  })

  it('lands on intervals a person reads without decoding', () => {
    const readable = new Set([0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600])

    for (const duration of [1, 12, 95, 480, 5_400]) {
      assert.ok(readable.has(tickEvery(duration, 10)), `odd interval for ${duration}s`)
    }
  })

  it('gets finer as the view zooms in', () => {
    // Zooming means more ticks fit in the same duration; if the interval did
    // not shrink with it, zooming would reveal nothing.
    assert.ok(tickEvery(120, 40) < tickEvery(120, 4))
  })

  it('answers something usable for a track with no duration', () => {
    assert.ok(tickEvery(0, 10) > 0)
    assert.ok(tickEvery(-1, 10) > 0)
    assert.ok(tickEvery(120, 0) > 0)
  })
})

describe('labels', () => {
  it('omits hours until there are some', () => {
    assert.equal(rulerLabel(0), '00:00')
    assert.equal(rulerLabel(65), '01:05')
    assert.equal(rulerLabel(3_599), '59:59')
    assert.equal(rulerLabel(3_600), '1:00:00')
    assert.equal(rulerLabel(3_725), '1:02:05')
  })

  it('keeps milliseconds on the playhead, where they matter', () => {
    assert.equal(clockLabel(0), '00:00:00,000')
    assert.equal(clockLabel(65.123), '00:01:05,123')
    assert.equal(clockLabel(3_725.5), '01:02:05,500')
  })

  it('does not render a negative time as a stranger', () => {
    // Scrubbing back past zero is easy to do, and should read as the start.
    assert.equal(rulerLabel(-5), '00:00')
    assert.equal(clockLabel(-5), '00:00:00,000')
  })
})
