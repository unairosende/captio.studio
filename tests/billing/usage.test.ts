import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { UsageByMonth } from '../../lib/db/billing.ts'
import { formatDuration, formatMonth, summariseUsage } from '../../lib/usage.ts'

/**
 * The consumption a customer is shown.
 *
 * Worth pinning down because the rows lie in wait for you: `units_in` is seconds
 * on a transcribe row and prompt tokens on a translate row, and every sum arrives
 * from `pg` as a string. Get either wrong and the dashboard reports a
 * plausible-looking figure that is out by orders of magnitude — which nobody
 * catches, because nobody knows what their real number should be.
 */

const row = (over: Partial<UsageByMonth>): UsageByMonth => ({
  month: '2026-08',
  kind: 'translate',
  model: 'gemini-3.6-flash',
  units_in: '0',
  units_out: '0',
  cost_usd: '0',
  cues: '0',
  calls: '1',
  ...over,
})

describe('summarising a month of usage', () => {
  it('adds the sums instead of concatenating them', () => {
    // The whole reason this function exists: `pg` returns bigint and numeric as
    // strings, and '600' + '900' is '600900'.
    const [month] = summariseUsage([
      row({ kind: 'transcribe', units_in: '600', calls: '1' }),
      row({ kind: 'transcribe', units_in: '900', calls: '2' }),
    ])

    assert.equal(month.transcribeSeconds, 1500)
    assert.equal(month.calls, 3)
  })

  it('keeps audio and subtitles apart', () => {
    // A translate row carries prompt tokens in units_in. Counting those as
    // seconds is how a dashboard claims eleven thousand hours of audio.
    const [month] = summariseUsage([
      row({ kind: 'transcribe', units_in: '3600', cues: '0' }),
      row({ kind: 'translate', units_in: '41000', cues: '840' }),
    ])

    assert.equal(month.transcribeSeconds, 3600)
    assert.equal(month.translatedCues, 840)
  })

  it('collapses the models into one row', () => {
    // The query groups by model, so changing model mid-month splits a month in
    // two. Which model translated a subtitle is our business, not the reader's.
    const summary = summariseUsage([
      row({ model: 'gemini-3.6-flash', cues: '500' }),
      row({ model: 'llama-3.3-70b-versatile', cues: '120' }),
    ])

    assert.equal(summary.length, 1)
    assert.equal(summary[0].translatedCues, 620)
  })

  it('returns the newest month first', () => {
    const summary = summariseUsage([
      row({ month: '2026-06' }),
      row({ month: '2026-08' }),
      row({ month: '2026-07' }),
    ])

    assert.deepEqual(
      summary.map(m => m.month),
      ['2026-08', '2026-07', '2026-06'],
    )
  })

  it('has nothing to say about an organisation that has run nothing', () => {
    assert.deepEqual(summariseUsage([]), [])
  })
})

describe('durations a person can read', () => {
  it('never reports real usage as nothing', () => {
    // Forty seconds transcribed is not zero minutes. Somebody checking whether
    // their trial had started would conclude the upload failed.
    assert.equal(formatDuration(40), '1 min')
  })

  it('says nothing only when nothing happened', () => {
    assert.equal(formatDuration(0), '0 min')
  })

  it('switches to hours without dropping the minutes', () => {
    assert.equal(formatDuration(3600), '1 h')
    assert.equal(formatDuration(4320), '1 h 12 min')
  })
})

describe('naming a month', () => {
  it('reads as a month, not as a key', () => {
    assert.equal(formatMonth('2026-08'), 'August 2026')
  })

  it('does not slip into the month before', () => {
    // January is the one that would show as December of the previous year, in
    // every timezone west of Greenwich.
    assert.equal(formatMonth('2026-01'), 'January 2026')
  })

  it('hands back anything it does not recognise', () => {
    assert.equal(formatMonth('not-a-month'), 'not-a-month')
  })
})
