import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { currentMonthCues, logUsage } from '../../lib/db/billing.ts'
import { db, query } from '../../lib/db/client.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * The month window, against a real Postgres.
 *
 * plan-limit.test.ts argues about the arithmetic; this is the half written in
 * SQL, which no pure test can reach: that the count starts again each calendar
 * month and counts translation only.
 *
 * Worth a database because both ways of getting it wrong are expensive and
 * quiet. Lose the date filter and the total becomes a lifetime one, so every
 * subscriber is walled a few months in having paid all along. Lose the kind
 * filter and an hour of audio starts spending the subtitle allowance.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const org = `test_org_${randomBytes(6).toString('hex')}`

// org_id is a foreign key to Better Auth's `organization`, so this has to be a
// real row.
before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [org, `Productora ${org.slice(-4)}`, org],
  )
})

after(async () => {
  if (!HAS_DB) return
  // Metering cascades from the organisation.
  await query('delete from "organization" where id = $1', [org])
  await db().end()
})

describe('the month a plan includes', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('counts this month’s translated subtitles and forgets last month’s', async () => {
    await logUsage({ orgId: org, kind: 'translate', model: 'x', cues: 120 })

    // Backdated by hand: logUsage always writes now(), and the whole question
    // here is what happens to a row on the far side of the boundary.
    await query(
      `insert into usage_events (org_id, kind, cues, created_at)
       values ($1, $2, $3, date_trunc('month', now()) - interval '1 day')`,
      [org, 'translate', 9_000],
    )

    assert.equal(await currentMonthCues(org), 120)
  })

  it('counts subtitles, not audio', async () => {
    // A transcription row is priced in seconds, and no plan denominates audio in
    // subtitles. Even carrying cues, it must not spend the monthly allowance.
    await logUsage({ orgId: org, kind: 'transcribe', model: 'x', unitsIn: 3600, cues: 500 })

    assert.equal(await currentMonthCues(org), 120)
  })

  it('keeps one organisation’s month out of another’s', async () => {
    const other = `test_org_${randomBytes(6).toString('hex')}`
    await query(
      'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
      [other, `Productora ${other.slice(-4)}`, other],
    )

    try {
      await logUsage({ orgId: other, kind: 'translate', model: 'x', cues: 40_000 })

      // Otherwise a busy neighbour spends this organisation's plan for them.
      assert.equal(await currentMonthCues(org), 120)
      assert.equal(await currentMonthCues(other), 40_000)
    } finally {
      await query('delete from "organization" where id = $1', [other])
    }
  })
})
