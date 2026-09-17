/**
 * What the browser needs to play a sequence's upload: where, what, and the
 * waveform to draw beside it.
 *
 * Built on the server from a media row (lib/storage/playback.ts) and, for a
 * file that was just dropped on the editor, in the browser from the file
 * itself — in which case `url` is a blob: URL and the bytes never moved. The
 * timeline does not care which.
 */
export interface Playback {
  /** A signed GET on the bucket, good for hours, or a blob: URL to a local file. */
  url: string
  /** `video/mp4`, `audio/wav`… What decides whether there is a picture to show. */
  contentType: string
  filename: string
  durationSeconds: number | null
  /** 0..1, PEAK_BUCKETS long, or empty when the upload could not be decoded. */
  peaks: number[]
}
