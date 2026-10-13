import { materialSeconds } from '../subtitles/cues.ts'
import { isUuid, query, queryOne, requireOrg } from './client.ts'

// ── Subscriptions ──────────────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'

export interface SubscriptionRow {
  id: string
  org_id: string
  stripe_customer_id: string
  status: SubscriptionStatus
  plan: string
  seats: number
  current_period_end: string | null
  created_at: string
  updated_at: string
}

const LIVE: SubscriptionStatus[] = ['active', 'trialing']

/** The subscription that currently entitles an org to use the product, if any. */
export async function getLiveSubscription(orgId: string): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(
    `select * from subscriptions
      where org_id = $1 and status = any($2)
      order by created_at desc
      limit 1`,
    [requireOrg(orgId), LIVE],
  )
}

export async function hasActiveSubscription(orgId: string): Promise<boolean> {
  return (await getLiveSubscription(orgId)) !== null
}

/**
 * The most recent subscription of any status.
 *
 * Erasure needs the id to cancel at Stripe, and a `past_due` one is as billable
 * as an active one — `getLiveSubscription` deliberately hides both, so it is the
 * wrong question here. Newest first, because an org that resubscribed after
 * cancelling has more than one row and only the last one is still live at Stripe.
 */
export async function latestSubscription(orgId: string): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(
    `select * from subscriptions where org_id = $1 order by created_at desc limit 1`,
    [requireOrg(orgId)],
  )
}

/**
 * The Stripe customer this organisation already has, if any.
 *
 * Deliberately ignores status: a cancelled subscription still identifies the
 * customer, and creating a second Stripe customer for the same organisation
 * splits its billing history and its saved payment methods in two.
 */
export async function getStripeCustomerId(orgId: string): Promise<string | null> {
  const row = await queryOne<{ stripe_customer_id: string }>(
    `select stripe_customer_id from subscriptions
      where org_id = $1
      order by created_at desc
      limit 1`,
    [requireOrg(orgId)],
  )
  return row?.stripe_customer_id ?? null
}

/**
 * Record what Stripe says, keyed by the Stripe subscription id.
 *
 * Webhooks arrive out of order and more than once, so this must be idempotent:
 * the same event replayed has to leave the same row, not a second one.
 */
export async function upsertSubscription(input: {
  id: string
  orgId: string
  stripeCustomerId: string
  status: SubscriptionStatus
  plan: string
  seats?: number
  currentPeriodEnd?: string | null
}): Promise<SubscriptionRow> {
  const rows = await query<SubscriptionRow>(
    `insert into subscriptions
       (id, org_id, stripe_customer_id, status, plan, seats, current_period_end)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set
       status             = excluded.status,
       plan               = excluded.plan,
       seats              = excluded.seats,
       current_period_end = excluded.current_period_end,
       updated_at         = now()
     returning *`,
    [
      input.id,
      requireOrg(input.orgId),
      input.stripeCustomerId,
      input.status,
      input.plan,
      input.seats ?? 1,
      input.currentPeriodEnd ?? null,
    ],
  )
  return rows[0]
}

// ── Usage ──────────────────────────────────────────────────────────────────

export type UsageKind = 'translate' | 'transcribe'

export interface UsageEventInput {
  orgId: string
  /**
   * The sequence the work was done on, where there is one.
   *
   * Optional because a translation can be run before anything has been saved.
   * The column is `on delete set null`: deleting a sequence must not delete the
   * record of what was spent on it, or a past month's bill changes retroactively.
   */
  sequenceId?: string | null
  userId?: string | null
  kind: UsageKind
  model?: string | null
  unitsIn?: number
  unitsOut?: number
  costUsd?: number
  /**
   * Subtitles handled, for a translation.
   *
   * Separate from the token counts because it answers a different question.
   * Tokens say what the provider charged; cues say how much of what the
   * customer was sold has been spent, and no arithmetic turns one into the
   * other.
   */
  cues?: number
}

/**
 * Metering write.
 *
 * A metering failure must never fail the user's request: the translation
 * already happened and the customer should get it. A dropped row costs an
 * under-count; a thrown error here costs a translation the provider already
 * billed us for.
 */
export async function logUsage(input: UsageEventInput): Promise<void> {
  try {
    await query(
      `insert into usage_events
         (org_id, sequence_id, user_id, kind, model, units_in, units_out, cost_usd, cues)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        requireOrg(input.orgId),
        input.sequenceId ?? null,
        input.userId ?? null,
        input.kind,
        input.model ?? null,
        input.unitsIn ?? 0,
        input.unitsOut ?? 0,
        input.costUsd ?? 0,
        input.cues ?? 0,
      ],
    )
  } catch (err) {
    console.error('usage_events insert failed', err)
  }
}

export interface UsageByMonth {
  month: string
  kind: UsageKind
  model: string | null
  units_in: string
  units_out: string
  cost_usd: string
  /**
   * Subtitles handled, and zero on a transcription row.
   *
   * The one figure a customer can check against their own files, which is why a
   * report cannot be built without it: `units_in` means seconds of audio on a
   * transcribe row and prompt tokens on a translate row, and no reader should be
   * expected to know that.
   */
  cues: string
  calls: string
}

export async function usageByMonth(orgId: string, months = 12): Promise<UsageByMonth[]> {
  return query<UsageByMonth>(
    `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
            kind,
            model,
            sum(units_in)  as units_in,
            sum(units_out) as units_out,
            sum(cost_usd)  as cost_usd,
            sum(cues)      as cues,
            count(*)       as calls
       from usage_events
      where org_id = $1
        and created_at >= date_trunc('month', now()) - make_interval(months => $2::int)
      group by month, kind, model
      -- Named rather than ordinal: ordering by a position means the next column
      -- added above this line quietly sorts the report by something else.
      order by month desc, cost_usd desc`,
    [requireOrg(orgId), months],
  )
}

/**
 * Charge a piece of material, once and only once.
 *
 * `billed_at is null` is the whole mechanism: the second call for the same
 * upload updates no rows and returns nothing, so translating it into a seventh
 * language costs nothing. That is how "every language included" survives
 * contact with a future caller who does not know it was promised.
 *
 * The duration is the one the server measured from the provider's own answer,
 * never `media.duration_seconds`: that column is filled from the browser at
 * upload time, and a billing quantity the browser supplies is a billing
 * quantity the browser can set to one second.
 *
 * Returns the seconds this call actually charged — zero when the material had
 * already been paid for.
 */
export async function billMedia(
  orgId: string,
  mediaId: string,
  seconds: number,
): Promise<number> {
  const row = await queryOne<{ billed_seconds: number }>(
    `update media
        set billed_seconds = $3,
            billed_at      = now()
      where org_id = $1 and id = $2 and billed_at is null
      returning billed_seconds`,
    [requireOrg(orgId), mediaId, Math.max(0, Math.ceil(seconds))],
  )
  return row?.billed_seconds ?? 0
}

/**
 * The same, for material that arrived as subtitles rather than as audio.
 *
 * The duration is the span of the cues, computed by the caller from the saved
 * sequence — never from the request. A billing quantity the browser supplies is
 * a billing quantity the browser can set to zero.
 */
export async function billSequence(
  orgId: string,
  sequenceId: string,
  seconds: number,
): Promise<number> {
  const row = await queryOne<{ billed_seconds: number }>(
    `update sequences
        set billed_seconds = $3,
            billed_at      = now()
      where org_id = $1 and id = $2 and billed_at is null
      returning billed_seconds`,
    [requireOrg(orgId), sequenceId, Math.max(0, Math.ceil(seconds))],
  )
  return row?.billed_seconds ?? 0
}

/**
 * Charge the material behind a saved sequence — subtitles that arrived as a
 * file rather than as audio — once.
 *
 * A cut made from another sequence (`derived_from`, migration 0014) is that
 * sequence's material in another format, so the origin is what gets charged,
 * and charging it pays for every cut made from it. An origin that has since
 * been deleted leaves the cut paying for itself, which is the only thing left
 * that can.
 *
 * The duration is measured from what is stored, never from the request: a
 * duration the browser supplies is a duration the browser can set to one
 * second.
 *
 * False when the sequence is not this organisation's, so the caller can answer
 * 404 without looking it up a second time.
 */
export async function billSequenceMaterial(orgId: string, sequenceId: string): Promise<boolean> {
  if (!isUuid(sequenceId)) return false
  const sequence = await queryOne<{ id: string; derived_from: string | null; data: unknown }>(
    `select id, derived_from, data from sequences where org_id = $1 and id = $2`,
    [requireOrg(orgId), sequenceId],
  )
  if (!sequence) return false

  const origin = sequence.derived_from
    ? await queryOne<{ id: string; data: unknown }>(
        `select id, data from sequences where org_id = $1 and id = $2`,
        [requireOrg(orgId), sequence.derived_from],
      )
    : null
  const payer = origin ?? sequence

  const data = payer.data as { subtitles?: unknown } | null
  await billSequence(orgId, payer.id, materialSeconds(data?.subtitles))
  await markDerivativesPaid(orgId, payer.id)
  return true
}

/**
 * Mark a sequence as already paid for, because its audio was.
 *
 * Called when a saved sequence is attached to an upload. Without it the same
 * material would be charged twice — once as minutes of audio at transcription,
 * again as a span of cues the first time somebody translated it — and the
 * customer would have no way of telling which of the two was the mistake.
 *
 * Zero seconds rather than the duration: the minutes are already recorded
 * against the media row, and counting them here as well would double the
 * month's consumption for every transcribed job.
 */
export async function markSequencePaid(orgId: string, sequenceId: string): Promise<void> {
  await query(
    `update sequences set billed_seconds = 0, billed_at = now()
      where org_id = $1 and id = $2 and billed_at is null`,
    [requireOrg(orgId), sequenceId],
  )
}

/**
 * Mark every cut made from a sequence as paid, because the sequence is.
 *
 * A horizontal and a vertical version of one recording are one piece of
 * material in two formats (migration 0014), and "charged once per piece of
 * material" has to survive that. Called whenever an origin becomes paid —
 * attached to an upload, or charged on its first translation — so that its
 * cuts never reach a charge of their own. Zero seconds, for the reason given
 * on markSequencePaid: the minutes are already counted on the origin.
 *
 * The same trust the upload path already extends: what a paid container holds
 * is not re-measured, here or there.
 */
export async function markDerivativesPaid(orgId: string, originId: string): Promise<void> {
  await query(
    `update sequences set billed_seconds = 0, billed_at = now()
      where org_id = $1 and derived_from = $2 and billed_at is null`,
    [requireOrg(orgId), originId],
  )
}

/**
 * Mark a new cut as paid when the sequence it was cut from already is.
 *
 * The other half of markDerivativesPaid: that one covers cuts that exist when
 * the origin is paid, this one a cut created afterwards. One statement, so the
 * check and the write cannot be separated by the origin changing in between.
 */
export async function inheritPayment(orgId: string, sequenceId: string, originId: string): Promise<void> {
  await query(
    `update sequences set billed_seconds = 0, billed_at = now()
      where org_id = $1 and id = $2 and billed_at is null
        and exists (select 1 from sequences where org_id = $1 and id = $3 and billed_at is not null)`,
    [requireOrg(orgId), sequenceId, originId],
  )
}

/**
 * Material charged in the current calendar month, in seconds.
 *
 * A calendar month rather than the Stripe billing period: the pricing page says
 * "per month", and an allowance turning over on whichever day somebody happened
 * to subscribe is a different promise from the one they read.
 *
 * Summed across both places material can enter from — an upload and an import —
 * because they spend the same pool.
 */
export async function currentMonthMediaSeconds(orgId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select coalesce((select sum(billed_seconds) from media
                       where org_id = $1 and billed_at >= date_trunc('month', now())), 0)
          + coalesce((select sum(billed_seconds) from sequences
                       where org_id = $1 and billed_at >= date_trunc('month', now())), 0)
            as total`,
    [requireOrg(orgId)],
  )
  return Number(row?.total ?? 0)
}

/**
 * Everything this organisation has ever spent against the free trial.
 *
 * Counted over the whole history rather than a window, because the trial has no
 * clock: it is an amount, and an amount that refilled monthly would be a free
 * plan with extra steps.
 */
export async function trialMediaSeconds(orgId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select coalesce((select sum(billed_seconds) from media     where org_id = $1), 0)
          + coalesce((select sum(billed_seconds) from sequences where org_id = $1), 0)
            as total`,
    [requireOrg(orgId)],
  )
  return Number(row?.total ?? 0)
}

/** Spend in the current calendar month, for quota enforcement. */
export async function currentMonthCostUsd(orgId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select coalesce(sum(cost_usd), 0) as total
       from usage_events
      where org_id = $1 and created_at >= date_trunc('month', now())`,
    [requireOrg(orgId)],
  )
  return Number(row?.total ?? 0)
}
