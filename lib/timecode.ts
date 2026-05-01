function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function tcToMs(t: string): number {
  const normalized = t.replace(',', '.')
  const parts = normalized.split(':')
  const [h, m, rest] = parts
  const [s, ms] = rest.split('.')
  return ((+h) * 3600 + (+m) * 60 + (+s)) * 1000 + +(ms || 0)
}

export function msToTc(ms: number): string {
  let remaining = ms
  const h = Math.floor(remaining / 3600000); remaining %= 3600000
  const m = Math.floor(remaining / 60000);   remaining %= 60000
  const s = Math.floor(remaining / 1000);    remaining %= 1000
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(remaining).padStart(3, '0')}`
}

export function midTimecode(start: string, end: string): string {
  return msToTc(Math.round((tcToMs(start) + tcToMs(end)) / 2))
}

export function secToSrt(sec: number): string {
  const h  = Math.floor(sec / 3600)
  const m  = Math.floor((sec % 3600) / 60)
  const s  = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, '0')}`
}
