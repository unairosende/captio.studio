import type { UsageByMonth } from './db/billing.ts'

/**
 * Turning metering rows into something a customer can read.
 *
 * `usage_events` is written one AI call at a time and grouped by month, kind and
 * model, so a single month arrives as several rows — one per model, and the
 * models change whenever we change them. None of that is the customer's
 * business: they transcribed some audio and translated some subtitles.
 *
 * The awkward part is that `units_in` means different things on different rows —
 * seconds of audio on a transcribe row, prompt tokens on a translate row — which
 * is exactly the sort of thing that ends up reporting nine million minutes of
 * video. Collapsing the rows here, once, with a test on it, is cheaper than
 * trusting every future caller to remember.
 *
 * `cost_usd` is deliberately not summarised. It is what the *provider* charges
 * *us*; putting it beside a subscription price invites the obvious question and
 * answers it wrongly, since it excludes everything else the price pays for.
 */

export interface MonthUsage {
  /** `YYYY-MM`. */
  month: string
  /** Seconds of audio transcribed. */
  transcribeSeconds: number
  /** Subtitles translated. */
  translatedCues: number
  /** AI calls made, both kinds together. */
  calls: number
}

/**
 * `pg` hands back `bigint` and `numeric` as strings, because they can hold more
 * than a JavaScript number represents exactly. These sums cannot — a month with
 * 2^53 seconds of audio in it is not a rounding problem — but the strings are
 * real, and `'12' + '30'` is `'1230'`. That is the bug this exists to avoid.
 */
const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0

/** Months, newest first, each collapsed to the two figures that were sold. */
export function summariseUsage(rows: UsageByMonth[]): MonthUsage[] {
  const months = new Map<string, MonthUsage>()

  for (const row of rows) {
    const month = months.get(row.month) ?? {
      month: row.month,
      transcribeSeconds: 0,
      translatedCues: 0,
      calls: 0,
    }

    // Each total reads only the column that means the same thing on every row it
    // touches: `cues` is zero on a transcribe row, and `units_in` is seconds on
    // that row alone.
    if (row.kind === 'transcribe') month.transcribeSeconds += num(row.units_in)
    else month.translatedCues += num(row.cues)

    month.calls += num(row.calls)
    months.set(row.month, month)
  }

  // Sorted here rather than left to the query's ORDER BY: the grouping above
  // discards row order anyway, and a caller that merged two queries would
  // otherwise get whichever order the Map happened to be filled in.
  return [...months.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
}

/**
 * Seconds as a person would say them.
 *
 * Minutes, not decimal hours: "0.62 h" is a number nobody has an intuition for,
 * and audio is booked in minutes everywhere else in this industry. Rounded up,
 * so forty seconds of transcription does not report as having used nothing.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 min'

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** `2026-08` as `August 2026`. */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  if (!year || !m) return month

  // Day one at noon UTC. Midnight can land in the previous month once a negative
  // timezone offset is applied, which renames every row on the page.
  return new Date(Date.UTC(year, m - 1, 1, 12)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}
