import { srtToSec } from './timecode.ts'
import type { Subtitle } from './types.ts'

/**
 * The cue on screen at a given second, or null between cues.
 *
 * What a <video> shows under the picture, in the editor and in the client's
 * viewer alike. The end is exclusive, so at the exact frame one cue ends and
 * the next begins there is one answer, not two; and overlaps — which the
 * quality checks flag but do not forbid — resolve to the earliest, which is
 * the one a viewer would have been reading already.
 */
export function cueAt(cues: Subtitle[], seconds: number): Subtitle | null {
  for (const cue of cues) {
    if (seconds >= srtToSec(cue.start) && seconds < srtToSec(cue.end)) return cue
  }
  return null
}
