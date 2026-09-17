import { PEAK_BUCKETS, peaksFrom } from './peaks.ts'

/**
 * A file's audio, decoded in the browser.
 *
 * Kept apart from peaks.ts because this half needs a browser: it goes through
 * the platform's decoders, which is what lets a video container be opened
 * without shipping one. An OfflineAudioContext rather than a live one, so no
 * output device is held and nothing has to be closed afterwards; at a low
 * sample rate, so a feature does not become gigabytes of floats to read a
 * waveform off — and mono is what the reduction looks at anyway.
 *
 * Null when the platform cannot decode it — ProRes, an odd container — which
 * is an ordinary answer, not an error: the file may still transcribe.
 */
export interface DecodedAudio {
  buffer: AudioBuffer
  peaks: Float32Array
  duration: number
}

/** Enough to draw and to transcribe from; speech lives well under 8 kHz. */
export const DECODE_RATE = 16_000

/**
 * What a file is, for the row and for the <video>.
 *
 * The browser's own answer when it has one; the platform leaves `type` empty
 * for containers it does not know, and a Matroska file is still footage. The
 * subtype only matters as far as `video/` versus `audio/` — the element sniffs
 * the rest.
 */
export function mediaType(file: File): string {
  if (file.type) return file.type
  return /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(file.name) ? 'video/mp4' : 'audio/mpeg'
}

export async function decodeAudio(file: File): Promise<DecodedAudio | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, DECODE_RATE)
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    return {
      buffer,
      peaks: peaksFrom(buffer.getChannelData(0), PEAK_BUCKETS),
      duration: buffer.duration,
    }
  } catch {
    return null
  }
}
