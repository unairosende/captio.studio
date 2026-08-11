import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_ZOOM, clampZoom, scrollToShow, visibleWindow } from '../../lib/timeline/view.ts'

/**
 * Scroll position in, seconds out.
 *
 * Nothing here throws when it is wrong. It just means clicking the waveform
 * seeks somewhere else, by an amount that grows with the zoom — which reads as
 * "the timeline is drifting" and is impossible to pin down by eye.
 */

/** A 600-second track, 1000px of viewport, zoomed by `zoom`. */
const at = (zoom: number, scrollLeft: number) => visibleWindow(600, scrollLeft, 1000 * zoom, 1000)

describe('the visible window', () => {
  it('shows the whole track unzoomed', () => {
    const view = at(1, 0)

    assert.equal(view.start, 0)
    assert.equal(view.span, 600)
  })

  it('shows proportionally less as it zooms', () => {
    assert.equal(at(2, 0).span, 300)
    assert.equal(at(10, 0).span, 60)
  })

  it('moves the left edge with the scrollbar', () => {
    // Half the scrollable width at 2x is halfway through the track.
    assert.equal(at(2, 1000).start, 300)
  })

  it('stops at the last full screen instead of scrolling into nothing', () => {
    // Past the end, the window would start beyond the audio and the canvas
    // would go blank — which reads as the file having failed to load.
    const view = at(4, 999_999)

    assert.equal(view.span, 150)
    assert.equal(view.start, 450, 'the last screen should end exactly at the end')
    assert.ok(view.start + view.span <= 600 + 1e-9)
  })

  it('never starts before the beginning', () => {
    assert.equal(at(4, -500).start, 0)
  })

  it('answers something drawable before any audio is loaded', () => {
    // The component renders once before a file exists; dividing by a zero
    // duration here would take the whole editor down with it.
    for (const view of [
      visibleWindow(0, 0, 0, 0),
      visibleWindow(600, 0, 0, 1000),
      visibleWindow(600, 0, 1000, 0),
    ]) {
      assert.ok(view.span > 0)
      assert.ok(Number.isFinite(view.start))
    }
  })
})

describe('zoom limits', () => {
  it('never goes below showing the whole track', () => {
    assert.equal(clampZoom(0.2), 1)
    assert.equal(clampZoom(-3), 1)
  })

  it('stops before the viewport is a few milliseconds wide', () => {
    assert.equal(clampZoom(1e6), MAX_ZOOM)
  })

  it('falls back to showing everything when the number is nonsense', () => {
    // Not to MAX_ZOOM: a value that came from broken arithmetic should land
    // somewhere a person can see where they are, not at the most extreme
    // setting the control offers.
    assert.equal(clampZoom(NaN), 1)
    assert.equal(clampZoom(Infinity), 1)
  })
})

describe('following the playhead', () => {
  const view = { start: 100, span: 100 }

  it('leaves the view alone while the playhead is comfortably inside it', () => {
    assert.equal(scrollToShow(150, view, 600, 6000), null)
  })

  it('moves once the playhead reaches the edge', () => {
    // Waiting until it has left would mean the playhead visibly disappears
    // before the view catches up.
    assert.notEqual(scrollToShow(195, view, 600, 6000), null)
    assert.notEqual(scrollToShow(300, view, 600, 6000), null)
  })

  it('centres on the playhead rather than pinning it to an edge', () => {
    const left = scrollToShow(300, view, 600, 6000)

    assert.ok(left !== null)
    // 6000px over 600s is 10px per second; centring 300s in a 100s window puts
    // the left edge at 250s.
    assert.equal(left, 2_500)
  })

  it('does not scroll past either end in order to centre', () => {
    assert.equal(scrollToShow(5, view, 600, 6000), 0)
    assert.equal(scrollToShow(599, view, 600, 6000), 5_000)
  })
})
