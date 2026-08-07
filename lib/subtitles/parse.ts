import type { Subtitle } from './types.ts'
import { DEFAULT_FPS } from './types.ts'
import { looksLikeTimecode, normalizeTc } from './timecode.ts'

/**
 * Split CSV text into rows of cells, honouring quoted fields.
 *
 * Subtitle text routinely contains commas and quotes, so a naive `split(',')`
 * corrupts real files.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  const RE = /("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|\r|$)/g
  let row: string[] = []
  let first = true

  for (const m of text.matchAll(RE)) {
    if (m[0] === '') break
    let val = m[1]
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/""/g, '"')
    row.push(val.trim())
    if (m[2] !== ',') {
      if (!first || row.some(c => c)) rows.push(row)
      row = []
      first = false
    }
  }
  if (row.length) rows.push(row)
  return rows
}

export function parseSrt(text: string, fps: number = DEFAULT_FPS): Subtitle[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map(block => {
      const lines = block.trim().split('\n')
      if (lines.length < 2) return null
      const index = parseInt(lines[0]) || 0
      const arrow = lines[1].indexOf('-->')
      if (arrow < 0) return null
      const start = normalizeTc(lines[1].slice(0, arrow), fps)
      const end = normalizeTc(lines[1].slice(arrow + 3), fps)
      // Strip styling tags; they are not round-tripped and break line-length checks.
      const txt = lines.slice(2).join('\n').replace(/<[^>]+>/g, '').trim()
      return txt ? { index, start, end, text: txt } : null
    })
    .filter((s): s is Subtitle => s !== null)
}

export function parseCsv(text: string, fps: number = DEFAULT_FPS): Subtitle[] {
  const rows = parseCsvRows(text)
  // A header row is anything whose first cell is not a timecode.
  const from = rows.length && !looksLikeTimecode(String(rows[0][0] ?? '')) ? 1 : 0

  return rows
    .slice(from)
    .map(cols => {
      if (cols.length >= 3 && looksLikeTimecode(String(cols[0]))) {
        const txt = cols.slice(2).join(' ').trim()
        return txt
          ? { index: 0, start: normalizeTc(cols[0], fps), end: normalizeTc(cols[1], fps), text: txt }
          : null
      }
      // Single-column file: plain text, timings filled in later.
      const txt = cols.join(' ').trim()
      return txt ? { index: 0, start: '00:00:00,000', end: '00:00:01,000', text: txt } : null
    })
    .filter((s): s is Subtitle => s !== null)
    .map((s, i) => ({ ...s, index: i + 1 }))
}

export function parseTxt(text: string): Subtitle[] {
  return text
    .trim()
    .split('\n')
    .filter(l => l.trim())
    .map((line, i) => ({
      index: i + 1,
      start: '00:00:00,000',
      end: '00:00:01,000',
      text: line.trim(),
    }))
}

/** What the importer was told the file is, if anything. */
export type ParseHint = 'auto' | 'srt' | 'csv' | 'txt'

/**
 * Pick a parser from an explicit hint, falling back to the file extension and
 * finally to SRT.
 */
export function parseContent(
  text: string,
  filename: string,
  hint: ParseHint = 'auto',
  fps: number = DEFAULT_FPS,
): Subtitle[] {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  const mode = hint !== 'auto' ? hint : ext
  if (mode === 'csv') return parseCsv(text, fps)
  if (mode === 'txt') return parseTxt(text)
  return parseSrt(text, fps)
}

/** Renumber cues from 1, keeping order. Every mutation that adds or removes cues needs this. */
export function renumber(subs: Subtitle[]): Subtitle[] {
  return subs.map((s, i) => ({ ...s, index: i + 1 }))
}
