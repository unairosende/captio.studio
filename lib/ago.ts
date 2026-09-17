/**
 * Elapsed time, said the way a person would say it.
 *
 * A column of `17/08/2026` tells you less at a glance than «hace 2 horas»,
 * and it sidesteps the trap absolute dates set for a component that renders
 * twice: the same instant formatted on a server running in UTC and again in
 * the reader's timezone is two different strings, which React reports as a
 * hydration mismatch. A difference between two clocks is the same everywhere.
 */

const RELATIVE = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

export function ago(value: string | Date): string {
  const delta = new Date(value).getTime() - Date.now()
  if (Number.isNaN(delta)) return ''
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return RELATIVE.format(Math.round(delta / ms), unit)
  }
  return 'ahora mismo'
}
