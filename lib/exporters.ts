import type { Subtitle } from '@/types/subtitle'
import { midTimecode } from './timecode'

const MAX_H = 42
const MAX_V = 32

export function splitForVertical(subs: Subtitle[]): Subtitle[] {
  const result: Subtitle[] = []
  let idx = 1
  subs.forEach(sub => {
    const lines = sub.text.split('\n')
    if (!lines.some(l => l.length > MAX_V) && lines.length <= 2) {
      result.push({ ...sub, index: idx++ })
      return
    }
    const all   = lines.join(' ').trim()
    let split   = all.lastIndexOf(' ', Math.ceil(all.length / 2))
    if (split < 1) split = Math.ceil(all.length / 2)
    const mid   = midTimecode(sub.start, sub.end)
    result.push({ index: idx++, start: sub.start, end: mid,     text: all.slice(0, split).trim() })
    result.push({ index: idx++, start: mid,       end: sub.end, text: all.slice(split).trim() })
  })
  return result
}

export function getFinalSubs(subs: Subtitle[], outputMode: 'horizontal' | 'vertical'): Subtitle[] {
  return outputMode === 'vertical' ? splitForVertical(subs) : subs
}

export function toSRT(subs: Subtitle[]): string {
  return subs.map((s, i) => `${i + 1}\n${s.start} --> ${s.end}\n${s.text}`).join('\n\n') + '\n'
}

export function toTXT(subs: Subtitle[]): string {
  return subs.map(s => s.text).join('\n')
}

export function toCSV(subs: Subtitle[]): string {
  return 'start,end,text\n' + subs.map(s => `${s.start},${s.end},"${s.text.replace(/"/g, '""')}"`).join('\n')
}

export function toVTT(subs: Subtitle[]): string {
  const tc = (t: string) => t.replace(',', '.')
  return 'WEBVTT\n\n' + subs.map((s, i) => `${i + 1}\n${tc(s.start)} --> ${tc(s.end)}\n${s.text}`).join('\n\n') + '\n'
}

export const maxLen = (mode: 'horizontal' | 'vertical') => mode === 'horizontal' ? MAX_H : MAX_V
