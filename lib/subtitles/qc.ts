import type { QcConfig, QcIssue, Severity, Subtitle } from './types.ts'
import { DEFAULT_QC } from './types.ts'
import { tcToMs } from './timecode.ts'

export function cueSeconds(sub: Subtitle): number {
  return (tcToMs(sub.end) - tcToMs(sub.start)) / 1000
}

/** Characters per second. `null` when the cue has no positive duration. */
export function cueCps(sub: Subtitle): number | null {
  const dur = cueSeconds(sub)
  if (dur <= 0) return null
  return (sub.text || '').replace(/\n/g, ' ').length / dur
}

/**
 * Text-only check, used for the live character bar while typing.
 *
 * Two lines is a hard ceiling regardless of configuration: it is a style-guide
 * rule across broadcast, not a preference.
 */
export function charStatus(text: string, cfg: QcConfig = DEFAULT_QC): Severity {
  const lines = (text || '').split('\n')
  const longest = Math.max(0, ...lines.map(l => l.length))
  const maxLines = Math.min(2, cfg.maxLines)
  if (longest > cfg.maxChars || lines.length > maxLines) return 'error'
  if (longest > Math.floor(cfg.maxChars * 0.85)) return 'warn'
  return 'ok'
}

/**
 * Full quality check for one cue.
 *
 * `prev` is the preceding cue, needed for gap and overlap checks. Timings live
 * on the source cues and every translation mirrors them, so callers should look
 * `prev` up in the source track, not in the translated one.
 */
export function qcIssues(
  sub: Subtitle,
  prev?: Subtitle | null,
  cfg: QcConfig = DEFAULT_QC,
): QcIssue[] {
  const issues: QcIssue[] = []
  const lines = (sub.text || '').split('\n')
  const longest = Math.max(0, ...lines.map(l => l.length))
  const maxLines = Math.min(2, cfg.maxLines)

  if (longest > cfg.maxChars) {
    issues.push({ level: 'error', msg: `Line too long — ${longest}/${cfg.maxChars} chars` })
  } else if (longest > Math.floor(cfg.maxChars * 0.85)) {
    issues.push({ level: 'warn', msg: `Line near limit — ${longest}/${cfg.maxChars} chars` })
  }
  if (lines.length > maxLines) {
    issues.push({ level: 'error', msg: `${lines.length} lines (max ${maxLines})` })
  }

  const dur = cueSeconds(sub)
  if (dur <= 0) {
    issues.push({ level: 'error', msg: 'End time is not after start time' })
  } else {
    const cps = cueCps(sub)!
    if (cps > cfg.cpsError) {
      issues.push({ level: 'error', msg: `Reading speed ${cps.toFixed(1)} cps (max ${cfg.cpsError})` })
    } else if (cps > cfg.cpsWarn) {
      issues.push({ level: 'warn', msg: `Reading speed ${cps.toFixed(1)} cps (over ${cfg.cpsWarn})` })
    }
    if (dur < cfg.minDur) {
      issues.push({ level: 'warn', msg: `Too short — ${dur.toFixed(2)}s (min ${cfg.minDur}s)` })
    }
    if (dur > cfg.maxDur) {
      issues.push({ level: 'warn', msg: `Too long — ${dur.toFixed(1)}s (max ${cfg.maxDur}s)` })
    }
  }

  if (prev) {
    const gap = (tcToMs(sub.start) - tcToMs(prev.end)) / 1000
    if (gap < 0) {
      issues.push({ level: 'error', msg: `Overlaps cue #${prev.index} by ${Math.abs(gap).toFixed(2)}s` })
    } else if (gap < cfg.minGap) {
      issues.push({ level: 'warn', msg: `Gap ${gap.toFixed(2)}s after cue #${prev.index} (min ${cfg.minGap}s)` })
    }
  }

  return issues
}

export function qcStatus(
  sub: Subtitle,
  prev?: Subtitle | null,
  cfg: QcConfig = DEFAULT_QC,
): Severity {
  const issues = qcIssues(sub, prev, cfg)
  if (issues.some(i => i.level === 'error')) return 'error'
  return issues.length ? 'warn' : 'ok'
}

/**
 * Check a whole track in one pass, pairing each cue with its predecessor.
 *
 * Preferred over calling `qcStatus` per card: it is one traversal instead of a
 * lookup per cue, which matters on feature-length tracks.
 */
export function qcTrack(
  subs: Subtitle[],
  cfg: QcConfig = DEFAULT_QC,
): Map<number, { status: Severity; issues: QcIssue[] }> {
  const out = new Map<number, { status: Severity; issues: QcIssue[] }>()
  subs.forEach((sub, i) => {
    const issues = qcIssues(sub, i > 0 ? subs[i - 1] : null, cfg)
    const status: Severity = issues.some(x => x.level === 'error')
      ? 'error'
      : issues.length
        ? 'warn'
        : 'ok'
    out.set(sub.index, { status, issues })
  })
  return out
}
