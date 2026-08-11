import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PEAK_BUCKETS, peakBetween, peaksFrom } from '../../lib/audio/peaks.ts'

/**
 * The waveform is how somebody finds the start of a line without listening to
 * the whole take. Wrong here is not a crash — it is a picture that disagrees
 * with the audio, and a subtitle timed against it lands in the wrong place.
 */

/** A tone at `amplitude`, so a bucket's expected peak is known exactly. */
function tone(samples: number, amplitude: number): Float32Array {
  const out = new Float32Array(samples)
  for (let i = 0; i < samples; i++) out[i] = Math.sin((i / 8) * Math.PI * 2) * amplitude
  return out
}

describe('reducing samples to peaks', () => {
  it('returns the requested number of buckets', () => {
    assert.equal(peaksFrom(tone(10_000, 0.5), 256).length, 256)
    assert.equal(peaksFrom(tone(10_000, 0.5)).length, PEAK_BUCKETS)
  })

  it('survives an empty track without dividing by zero', () => {
    const peaks = peaksFrom(new Float32Array(0), 8)

    assert.equal(peaks.length, 8)
    assert.ok(peaks.every(v => v === 0))
  })

  it('leaves silence silent instead of amplifying it', () => {
    // Normalising by the loudest moment would turn a room tone of 1e-9 into a
    // full-height waveform, which reads as speech where there is none.
    const peaks = peaksFrom(new Float32Array(1_000), 16)

    assert.ok(peaks.every(v => v === 0))
  })

  it('normalises against the track, so a quiet recording is still readable', () => {
    const loud = peaksFrom(tone(10_000, 0.9), 64)
    const quiet = peaksFrom(tone(10_000, 0.02), 64)

    assert.ok(Math.max(...loud) > 0.99)
    assert.ok(Math.max(...quiet) > 0.99, 'a quiet track should fill the same height')
  })

  it('keeps a transient instead of averaging it away', () => {
    // One loud sample in an otherwise silent bucket. An averaging reducer would
    // bury it; the whole point of the waveform is that it does not.
    const samples = new Float32Array(1_000)
    samples[500] = 1

    const peaks = peaksFrom(samples, 10)

    assert.equal(peaks[5], 1, 'the spike should own its bucket')
    assert.equal(peaks.filter(v => v > 0).length, 1)
  })

  it('reaches the end of the track', () => {
    // A fixed integer stride drops the remainder, and the waveform then stops
    // before the audio does — subtly, and only for some file lengths.
    const samples = new Float32Array(1_003)
    samples[1_002] = 1

    const peaks = peaksFrom(samples, 10)

    assert.equal(peaks[9], 1, 'the last bucket should include the final sample')
  })

  it('covers every sample, with no gaps between buckets', () => {
    const samples = new Float32Array(997).fill(0.5)

    const peaks = peaksFrom(samples, 100)

    assert.ok(peaks.every(v => v > 0.99), 'every bucket should have seen samples')
  })
})

describe('the peak under one bar', () => {
  const peaks = Float32Array.from({ length: 100 }, (_, i) => (i === 50 ? 1 : 0.1))

  it('finds a spike anywhere inside the bar', () => {
    // 100 buckets over 10 seconds: bucket 50 is halfway.
    assert.equal(peakBetween(peaks, 10, 4.9, 5.2), 1)
  })

  it('reports the quiet level away from it', () => {
    // Compared with a tolerance: a Float32Array holds 0.1 as 0.10000000149,
    // and an exact assertion here would be testing IEEE 754, not the code.
    assert.ok(Math.abs(peakBetween(peaks, 10, 1, 2) - 0.1) < 1e-6)
  })

  it('answers zero rather than throwing on an unloaded track', () => {
    assert.equal(peakBetween(new Float32Array(0), 0, 0, 1), 0)
    assert.equal(peakBetween(peaks, 0, 0, 1), 0)
  })

  it('stays inside the array at the very end', () => {
    assert.doesNotThrow(() => peakBetween(peaks, 10, 9.99, 10))
  })
})
