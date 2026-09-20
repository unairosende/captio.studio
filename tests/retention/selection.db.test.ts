import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import {
  markRetentionWarned,
  orgsDueForErasure,
  orgsDueForRetentionWarning,
} from '../../lib/db/retention.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Who the retention sweep picks, against a real Postgres.
 *
 * The window arithmetic lives entirely in SQL — the ninety-day cliff, the
 * seven-day notice floor, "only the latest subscription counts", "never an org
 * that resubscribed" — so no pure test can reach it, and every way of getting it
 * wrong deletes a customer's work early or bills a storage account for ever.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

async function newOrg(): Promise<string> {
  const id = `test_org_${randomBytes(6).toString('hex')}`
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [id, `Productora ${id.slice(-4)}`, id],
  )
  return id
}

/** A subscription row with its clocks placed by hand. */
async function newSub(
  orgId: string,
  opts: {
    status: string
    endedDaysAgo: number | null
    warnedDaysAgo?: number | null
    createdDaysAgo?: number
  },
): Promise<string> {
  const id = `sub_${randomBytes(8).toString('hex')}`
  await query(
    `insert into subscriptions
       (id, org_id, stripe_customer_id, status, plan, seats,
        current_period_end, retention_warned_at, created_at)
     values ($1, $2, $3, $4, 'team', 5, $5, $6, $7)`,
    [
      id,
      orgId,
      `cus_${randomBytes(6).toString('hex')}`,
      opts.status,
      opts.endedDaysAgo === null ? null : daysAgo(opts.endedDaysAgo),
      opts.warnedDaysAgo == null ? null : daysAgo(opts.warnedDaysAgo),
      daysAgo(opts.createdDaysAgo ?? opts.endedDaysAgo ?? 0),
    ],
  )
  return id
}

const created: string[] = []
async function org(): Promise<string> {
  const id = await newOrg()
  created.push(id)
  return id
}

after(async () => {
  if (!HAS_DB) return
  // Everything cascades from the organisation.
  for (const id of created) await query('delete from "organization" where id = $1', [id])
  await db().end()
})

describe('retention selection', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('warns a cancelled org past the notice threshold, once it is there', async () => {
    if (!HAS_DB) return
    await requireDisposableDatabase()

    const due = await org()
    await newSub(due, { status: 'canceled', endedDaysAgo: 100 })
    const notYet = await org()
    await newSub(notYet, { status: 'canceled', endedDaysAgo: 50 })

    const ids = (await orgsDueForRetentionWarning()).map(r => r.orgId)
    assert.ok(ids.includes(due), 'a 100-day cancellation is past the 83-day warning line')
    assert.ok(!ids.includes(notYet), 'a 50-day cancellation is not')
  })

  it('does not warn an org already warned, nor one still live', async () => {
    if (!HAS_DB) return

    const warned = await org()
    await newSub(warned, { status: 'canceled', endedDaysAgo: 100, warnedDaysAgo: 5 })
    const resubscribed = await org()
    await newSub(resubscribed, { status: 'canceled', endedDaysAgo: 100, createdDaysAgo: 120 })
    await newSub(resubscribed, { status: 'active', endedDaysAgo: null, createdDaysAgo: 1 })

    const ids = (await orgsDueForRetentionWarning()).map(r => r.orgId)
    assert.ok(!ids.includes(warned), 'already warned')
    assert.ok(!ids.includes(resubscribed), 'has a live subscription again')
  })

  it('erases only once both the window and the notice have run', async () => {
    if (!HAS_DB) return

    const ripe = await org()
    await newSub(ripe, { status: 'canceled', endedDaysAgo: 100, warnedDaysAgo: 10 })
    const warnedTooRecently = await org()
    await newSub(warnedTooRecently, { status: 'canceled', endedDaysAgo: 100, warnedDaysAgo: 2 })
    const neverWarned = await org()
    await newSub(neverWarned, { status: 'canceled', endedDaysAgo: 100 })

    const ids = (await orgsDueForErasure()).map(r => r.orgId)
    assert.ok(ids.includes(ripe), 'past the window and warned long enough ago')
    assert.ok(!ids.includes(warnedTooRecently), 'warned only two days ago, inside the notice floor')
    assert.ok(!ids.includes(neverWarned), 'never warned, so the notice clock never started')
  })

  it('reads the org from its most recent subscription, not an old one', async () => {
    if (!HAS_DB) return

    // An old cancellation that was warned, then a fresh cancellation that was
    // not: the org is due a new warning, and must not be judged by the stale row.
    const orgId = await org()
    await newSub(orgId, { status: 'canceled', endedDaysAgo: 300, warnedDaysAgo: 200, createdDaysAgo: 300 })
    await newSub(orgId, { status: 'canceled', endedDaysAgo: 100, createdDaysAgo: 100 })

    const warnIds = (await orgsDueForRetentionWarning()).map(r => r.orgId)
    const eraseIds = (await orgsDueForErasure()).map(r => r.orgId)
    assert.equal(warnIds.filter(id => id === orgId).length, 1, 'due once, by the latest row')
    assert.ok(!eraseIds.includes(orgId), 'the latest row has not been warned, so not erasable')
  })

  it('starts the notice clock when the warning is marked', async () => {
    if (!HAS_DB) return

    const orgId = await org()
    const subId = await newSub(orgId, { status: 'canceled', endedDaysAgo: 100 })

    assert.ok((await orgsDueForRetentionWarning()).some(r => r.orgId === orgId))
    await markRetentionWarned(subId)
    assert.ok(
      !(await orgsDueForRetentionWarning()).some(r => r.orgId === orgId),
      'once marked, it is no longer awaiting a warning',
    )
  })
})
