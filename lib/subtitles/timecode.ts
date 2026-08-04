import { DEFAULT_FPS } from './types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** Matches `HH:MM:SS,mmm` / `H:MM:SS.mmm` / `MM:SS,mmm`, with 2- or 3-digit sub-seconds. */
const TC_RE = /^\d{1,2}:\d{2}:\d{2}[,.:]\d{2,3}$|^\d{1,2}:\d{2}[,.:]\d{2,3}$/

export function looksLikeTimecode(s: string | null | undefined): boolean {
  return TC_RE.test((s ?? '').trim())
}

/** SRT timecode → milliseconds. Accepts both `,` and `.` as the decimal mark. */
export function tcToMs(t: string): number {
  const [h, m, rest] = t.replace(',', '.').split(':')
  const [s, ms] = (rest ?? '').split('.')
  return ((+h) * 3600 + (+m) * 60 + (+s)) * 1000 + +(ms || 0)
}

/** Milliseconds → SRT timecode `HH:MM:SS,mmm`. */
export function msToTc(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const msPart = total % 1000
  const secs = Math.floor(total / 1000)
  return (
    pad(Math.floor(secs / 3600)) +
    ':' +
    pad(Math.floor((secs % 3600) / 60)) +
    ':' +
    pad(secs % 60) +
    ',' +
    String(msPart).padStart(3, '0')
  )
}

/**
 * Seconds → SRT timecode, snapped to the nearest frame boundary.
 *
 * Editors deliver on frame boundaries; emitting arbitrary millisecond values
 * produces cues that land mid-frame and drift when re-imported into an NLE.
 */
export function secToSrt(sec: number, fps: number = DEFAULT_FPS): string {
  const snapped = Math.round((sec || 0) * fps) / fps
  return msToTc(snapped * 1000)
}

/** SRT timecode → seconds. Returns 0 for anything unparseable. */
export function srtToSec(srt: string | null | undefined): number {
  if (!srt) return 0
  const m = srt.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return 0
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
}

/**
 * Normalise any incoming timecode to SRT `HH:MM:SS,mmm`.
 *
 * A 2-digit sub-second part means **frames**, not milliseconds — that is how
 * Avid, Premiere and most CSV exports write timecode (`HH:MM:SS:FF`). Treating
 * `00:00:01:12` as 12ms instead of frame 12 (480ms at 25fps) silently shifts
 * every cue, so the frame case is converted explicitly.
 */
export function normalizeTc(input: string | null | undefined, fps: number = DEFAULT_FPS): string {
  const s = (input ?? '').trim()

  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.:"](\d{2,3})$/)
  if (hms) {
    const sub = hms[4]
    const ms = sub.length === 2 ? Math.round((+sub * 1000) / fps) : +sub
    return `${pad(+hms[1])}:${pad(+hms[2])}:${pad(+hms[3])},${String(ms).padStart(3, '0')}`
  }

  const mmss = s.match(/^(\d{1,2}):(\d{2})[,.:"](\d{2,3})$/)
  if (mmss) {
    const sub = mmss[3]
    const ms = sub.length === 2 ? Math.round((+sub * 1000) / fps) : +sub
    return `00:${pad(+mmss[1])}:${pad(+mmss[2])},${String(ms).padStart(3, '0')}`
  }

  // Unrecognised shape: at least make the decimal mark SRT-flavoured.
  return s.replace('.', ',')
}

/** Timecode exactly between two cues, used when splitting. */
export function midTimecode(start: string, end: string): string {
  return msToTc(Math.round((tcToMs(start) + tcToMs(end)) / 2))
}
