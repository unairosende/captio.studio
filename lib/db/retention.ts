import { RETENTION_DAYS, RETENTION_NOTICE_DAYS } from '../retention.ts'
import { query } from './client.ts'

/**
 * The organisations the retention sweep acts on.
 *
 * Like the sweeper's list of organisation ids, these read across every tenant
 * on purpose: a retention run has to start from all of them, and there is no
 * customer work in the columns selected — only which organisation lapsed and
 * when. Everything the cron does per row is still scoped by the id it is holding.
 *
 * The "who is due" conditions are written out in full in both queries rather
 * than shared through a constant: the tenancy test forbids `${}` inside a SQL
 * string, and rightly — an interpolated fragment is how an org_id filter gets
 * bypassed — so the shared lines are repeated instead. The statuses are bound as
 * parameters, not written as literals, for the same reason and to satisfy the
 * same test. They are fussier than they look:
 *
 *  - Only the organisation's most recent subscription counts. An org that
 *    cancelled, came back, and cancelled again has several rows; the old ones
 *    carry a stale `retention_warned_at` and an old period end, and acting on
 *    them would warn — or erase — an account that is currently paying or on a
 *    fresh clock.
 *  - An organisation with any live subscription is never a candidate, even if an
 *    older row is cancelled: it resubscribed, and its data is not going anywhere.
 *  - `current_period_end` is the moment paid access actually ended, which Stripe
 *    sets at cancellation. The window is measured from there, not from whenever
 *    the row was last touched.
 */

const CANCELED = 'canceled'
const LIVE = ['active', 'trialing']

export interface RetentionRow {
  orgId: string
  orgName: string
  subId: string
  /** When paid access ended; the window is measured from here. */
  currentPeriodEnd: string
}

interface Raw {
  org_id: string
  org_name: string
  sub_id: string
  current_period_end: string
}

const toRow = (r: Raw): RetentionRow => ({
  orgId: r.org_id,
  orgName: r.org_name,
  subId: r.sub_id,
  currentPeriodEnd: r.current_period_end,
})

/**
 * Cancelled organisations near the end of the window that have not been warned.
 *
 * "Near the end" is the window minus the notice: warn with the notice period to
 * spare, so the owner has the full stretch to act before anything is deleted.
 */
export async function orgsDueForRetentionWarning(): Promise<RetentionRow[]> {
  const rows = await query<Raw>(
    `select s.org_id, o.name as org_name, s.id as sub_id, s.current_period_end
       from subscriptions s
       join "organization" o on o.id = s.org_id
      where s.status = $2
        and s.current_period_end is not null
        and s.retention_warned_at is null
        and s.current_period_end < now() - make_interval(days => $1::int)
        and s.created_at = (select max(created_at) from subscriptions s3 where s3.org_id = s.org_id)
        and not exists (
          select 1 from subscriptions s2
          where s2.org_id = s.org_id and s2.status = any($3)
        )`,
    [RETENTION_DAYS - RETENTION_NOTICE_DAYS, CANCELED, LIVE],
  )
  return rows.map(toRow)
}

/**
 * Cancelled organisations whose window is up and whose notice has had time to land.
 *
 * Both clocks must have run: the full window since access ended, and the notice
 * period since the warning was actually sent. The second is what stops a burst
 * of catch-up cron runs from erasing an account the same day it was warned.
 */
export async function orgsDueForErasure(): Promise<RetentionRow[]> {
  const rows = await query<Raw>(
    `select s.org_id, o.name as org_name, s.id as sub_id, s.current_period_end
       from subscriptions s
       join "organization" o on o.id = s.org_id
      where s.status = $3
        and s.current_period_end is not null
        and s.retention_warned_at is not null
        and s.current_period_end < now() - make_interval(days => $1::int)
        and s.retention_warned_at < now() - make_interval(days => $2::int)
        and s.created_at = (select max(created_at) from subscriptions s3 where s3.org_id = s.org_id)
        and not exists (
          select 1 from subscriptions s2
          where s2.org_id = s.org_id and s2.status = any($4)
        )`,
    [RETENTION_DAYS, RETENTION_NOTICE_DAYS, CANCELED, LIVE],
  )
  return rows.map(toRow)
}

/**
 * Record that the warning went out, which starts the notice clock.
 *
 * Keyed by the subscription id, and only ever called after a message actually
 * sent: the erasure query above will not touch a row whose `retention_warned_at`
 * is null, so leaving it null on a failed send simply means trying again next run
 * rather than deleting without notice.
 */
export async function markRetentionWarned(subId: string): Promise<void> {
  await query(`update subscriptions set retention_warned_at = now() where id = $1`, [subId])
}
