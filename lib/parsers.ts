import type { Subtitle } from '@/types/subtitle'

export function parseSRT(text: string): Subtitle[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map(block => {
      const lines = block.trim().split('\n')
      if (lines.length < 2) return null
      const idx = parseInt(lines[0]) || 0
      const arrow = lines[1].indexOf('-->')
      if (arrow < 0) return null
      const start = lines[1].slice(0, arrow).trim()
      const end   = lines[1].slice(arrow + 3).trim()
      const txt   = lines.slice(2).join('\n').replace(/<[^>]+>/g, '').trim()
      return txt ? { index: idx, start, end, text: txt } : null
    })
    .filter(Boolean) as Subtitle[]
}

export function parseCSV(text: string): Subtitle[] {
  return text
    .trim()
    .split('\n')
    .map((line, i) => {
      if (i === 0 && /^start\s*,/i.test(line)) return null
      const parts = line.split(',')
      if (parts.length >= 3) {
        const txt = parts.slice(2).join(',').replace(/^"|"$/g, '').trim()
        return txt ? { index: i, start: parts[0].trim(), end: parts[1].trim(), text: txt } : null
      }
      const txt = line.replace(/^"|"$/g, '').trim()
      return txt ? { index: i + 1, start: '00:00:00,000', end: '00:00:01,000', text: txt } : null
    })
    .filter(Boolean)
    .map((s, i) => ({ ...(s as Subtitle), index: i + 1 })) as Subtitle[]
}

export function parseTXT(text: string): Subtitle[] {
  return text
    .trim()
    .split('\n')
    .filter(l => l.trim())
    .map((line, i) => ({
      index: i + 1,
      start: '00:00:00,000',
      end:   '00:00:01,000',
      text:  line.trim(),
    }))
}

export function parseContent(text: string, filename: string, hint: string): Subtitle[] {
  const ext  = (filename.split('.').pop() || '').toLowerCase()
  const mode = hint !== 'auto' ? hint : ext
  if (mode === 'csv') return parseCSV(text)
  if (mode === 'txt') return parseTXT(text)
  return parseSRT(text)
}
