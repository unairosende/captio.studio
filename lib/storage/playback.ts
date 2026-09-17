import { playableMedia } from '../db/media.ts'
import type { Playback } from '../../types/media.ts'
import { StorageNotConfiguredError, presign } from './r2.ts'

/**
 * How long a playback URL stays good.
 *
 * A working day and some: the editor is left open across lunch, and a <video>
 * whose URL has expired fails on the next unbuffered seek with nothing to say
 * about why. Longer than an upload grant because it opens one object for
 * reading, and the object is the customer's own.
 *
 * ponytail: no refresh on expiry. A tab open past this reloads to keep seeking;
 * re-signing on the element's error event is the upgrade if anybody hits it.
 */
const PLAYBACK_WINDOW = 12 * 60 * 60

/**
 * The sequence's upload, ready for a <video>.
 *
 * Read by the pages that render a sequence — the editor, the team's review, the
 * client's link — and by the route the editor switches sequences through. All
 * of them already resolved the organisation on the server; this only asks the
 * bucket for a URL, so a guest never gets a route of their own for it.
 *
 * Null without a bucket, rather than an error: a development machine with no
 * R2 keys should still open the editor, just without the picture.
 */
export async function sequencePlayback(orgId: string, sequenceId: string): Promise<Playback | null> {
  const media = await playableMedia(orgId, sequenceId)
  if (!media?.content_type) return null

  let url: string
  try {
    url = presign('GET', media.storage_key, { expiresIn: PLAYBACK_WINDOW })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return null
    throw err
  }

  return {
    url,
    contentType: media.content_type,
    filename: media.filename ?? '',
    durationSeconds: media.duration_seconds === null ? null : Number(media.duration_seconds),
    peaks: media.peaks ?? [],
  }
}
