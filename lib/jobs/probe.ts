import type { FileFacts } from '../assistant/prompt.ts'
import { decodeAudio, mediaType } from '../audio/decode.ts'
import { packPeaks } from '../audio/peaks.ts'
import { materialSeconds } from '../subtitles/cues.ts'
import { parseContent } from '../subtitles/parse.ts'
import type { Subtitle } from '../subtitles/types.ts'
import type { UploadMeta } from './upload.ts'

/**
 * What a dropped file is, found out in the browser without sending it anywhere.
 *
 * Two answers come back. The facts are for the project assistant, which reads
 * them to work out what the file is and what can be made of it — a 9:16 frame,
 * a "subtitle file" that turns out to be a transcript with no timings. The
 * material is for Captio itself: the recording to upload, or the cues the
 * subtitles parsed into, so the work starts from what was already read here.
 */

export interface Probe {
  facts: FileFacts
  /** Set for a recording: what to upload it with. */
  media: UploadMeta | null
  /** Set for subtitles or text: what they parsed into. */
  cues: Subtitle[] | null
}

/** Containers the platform can be asked to play, by extension, when the type is empty. */
const MEDIA = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|mp4|m4v|mov|mkv|webm|avi)$/i
const TEXT = /\.(srt|vtt|csv|txt)$/i

/** Large enough for any subtitle file; a "text" file past it is not one. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024

const SAMPLE = 40

/** The picture's size, read from the metadata alone — nothing is decoded. */
function pictureSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      done(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

/** What every probe says about a file, before anybody has looked inside it. */
function blank(file: File, kind: FileFacts['kind']): FileFacts {
  return {
    kind,
    name: file.name,
    type: file.type,
    bytes: file.size,
    durationSeconds: null,
    width: null,
    height: null,
    format: null,
    cueCount: null,
    timed: null,
    spanSeconds: null,
    sample: [],
  }
}

/**
 * Whether a cue carries a real timing.
 *
 * The TXT and single-column CSV readers give every line the same placeholder,
 * one second at zero (lib/subtitles/parse.ts) — the timings are to be set
 * later, by hand. A file made only of placeholders has none of its own.
 */
const placeholder = (c: Subtitle) => c.start === '00:00:00,000' && c.end === '00:00:01,000'

export async function probeFile(file: File): Promise<Probe> {
  const type = file.type
  const isMedia = type.startsWith('audio/') || type.startsWith('video/') || (!type && MEDIA.test(file.name))

  if (isMedia) {
    const contentType = mediaType(file)
    const video = contentType.startsWith('video/')
    const [decoded, picture] = await Promise.all([decodeAudio(file), video ? pictureSize(file) : null])
    const facts: FileFacts = {
      ...blank(file, video ? 'video' : 'audio'),
      type: contentType,
      durationSeconds: decoded?.duration ?? null,
      width: picture?.width ?? null,
      height: picture?.height ?? null,
    }
    return {
      facts,
      media: {
        contentType,
        durationSeconds: decoded?.duration ?? null,
        peaks: decoded ? packPeaks(decoded.peaks) : [],
      },
      cues: null,
    }
  }

  const isText = type.startsWith('text/') || TEXT.test(file.name) || type === 'application/x-subrip'
  if (!isText || file.size > MAX_TEXT_BYTES) return { facts: blank(file, 'other'), media: null, cues: null }

  const text = await file.text()
  const format = (file.name.split('.').pop() ?? '').toLowerCase() || 'srt'
  const cues = parseContent(text, file.name)

  if (!cues.length) {
    // Nothing a subtitle reader recognises: show the model the words, and let
    // it say what they are.
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, SAMPLE)
    return { facts: { ...blank(file, 'text'), format, cueCount: 0, sample: lines }, media: null, cues: null }
  }

  const timed = cues.some(c => !placeholder(c))
  return {
    facts: {
      ...blank(file, 'subtitles'),
      format,
      cueCount: cues.length,
      timed,
      spanSeconds: timed ? materialSeconds(cues) : null,
      sample: cues.slice(0, SAMPLE).map(c => `${c.index} | ${c.text.replace(/\n/g, ' / ')}`),
    },
    media: null,
    cues,
  }
}
