export interface Subtitle {
  index: number
  /** SRT timecode, `HH:MM:SS,mmm` */
  start: string
  end: string
  text: string
  /**
   * What the transcription or the translation wrote, before anybody touched it.
   *
   * Kept beside the text rather than in a version: saves by the same author
   * are squashed together, so the first version is gone by the second edit.
   * Comparing the two is how the product learns what the team corrects — see
   * lib/subtitles/corrections.ts. Absent on anything imported or split.
   */
  machine?: string
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ttml' | 'csv' | 'txt'

export type Severity = 'ok' | 'warn' | 'error'

export interface QcIssue {
  level: 'warn' | 'error'
  msg: string
}

/**
 * Thresholds for quality checks. `maxChars` is already resolved for the current
 * output mode (horizontal vs vertical) — this layer does not know about modes.
 */
export interface QcConfig {
  maxChars: number
  maxLines: number
  /** characters per second */
  cpsWarn: number
  cpsError: number
  /** seconds */
  minDur: number
  maxDur: number
  minGap: number
}

export const DEFAULT_QC: QcConfig = {
  maxChars: 42,
  maxLines: 2,
  cpsWarn: 17,
  cpsError: 21,
  minDur: 0.83,
  maxDur: 7,
  minGap: 0.08,
}

/**
 * Frame rate used to interpret and emit frame-accurate timecodes.
 *
 * Broadcast work is not all 25fps: PAL is 25, NTSC film is 23.976, and web
 * deliverables are often 30. Callers should pass the project's real rate rather
 * than relying on this default.
 */
export const DEFAULT_FPS = 25
