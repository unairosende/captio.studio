/**
 * Waveform peaks, reduced from raw samples.
 *
 * A minute of audio is nearly three million samples and a timeline is a few
 * hundred pixels wide, so the drawing code must never see the samples. They are
 * reduced once, on load, to a fixed number of buckets that can then be scaled
 * to any width and any zoom.
 *
 * Peak per bucket rather than average: averaging washes out transients, and a
 * waveform whose job is to show where speech starts has to keep the attack of a
 * consonant. Averaged dialogue looks like a flat sausage.
 *
 * Kept apart from decoding, which needs a browser and cannot be tested. This
 * half is arithmetic, and is covered by tests.
 */

/** How many buckets a track is reduced to. Enough detail for a deep zoom. */
export const PEAK_BUCKETS = 4_000

export function peaksFrom(samples: Float32Array, buckets = PEAK_BUCKETS): Float32Array {
  const out = new Float32Array(buckets)
  if (samples.length === 0 || buckets <= 0) return out

  // Fractional stride: a fixed integer step drops the tail of the track when
  // the sample count is not a multiple of the bucket count, which shows up as
  // a waveform that stops before the audio does.
  const stride = samples.length / buckets

  let loudest = 0
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * stride)
    const to = Math.max(from + 1, Math.min(samples.length, Math.floor((b + 1) * stride)))

    let peak = 0
    for (let i = from; i < to; i++) {
      const v = samples[i] < 0 ? -samples[i] : samples[i]
      if (v > peak) peak = v
    }
    out[b] = peak
    if (peak > loudest) loudest = peak
  }

  // Normalised against the track's own loudest moment, so a quietly recorded
  // interview reads as clearly as a loud one. Silence stays silent rather than
  // being amplified into noise: the guard only avoids dividing by zero.
  if (loudest > 0.0001) {
    for (let b = 0; b < buckets; b++) out[b] /= loudest
  }

  return out
}

/**
 * The loudest peak between two times, for drawing one bar.
 *
 * Takes the maximum across every bucket the bar covers rather than sampling one
 * of them. Sampling makes a zoomed-out waveform flicker as it redraws, because
 * which bucket gets picked changes with the width.
 */
export function peakBetween(
  peaks: Float32Array,
  duration: number,
  from: number,
  to: number,
): number {
  if (peaks.length === 0 || duration <= 0) return 0

  const first = Math.max(0, Math.floor((from / duration) * peaks.length))
  const last = Math.min(peaks.length - 1, Math.ceil((to / duration) * peaks.length))

  let peak = 0
  for (let i = first; i <= last; i++) if (peaks[i] > peak) peak = peaks[i]
  return peak
}
