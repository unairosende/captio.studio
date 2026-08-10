import { query, queryOne, requireOrg } from './client.ts'

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
  projectId?: string | null
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
         (org_id, project_id, user_id, kind, model, units_in, units_out, cost_usd, cues)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        requireOrg(input.orgId),
        input.projectId ?? null,
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

export interface TrialConsumption {
  /** Seconds of audio transcribed. */
  transcribeSeconds: number
  /** Subtitles translated. */
  translatedCues: number
}

/**
 * Everything this organisation has ever spent against the free trial.
 *
 * Counted over the whole history rather than a window, because the trial has no
 * clock: it is an amount, and an amount that refilled monthly would be a free
 * plan with extra steps.
 *
 * The kinds are parameters rather than literals so this statement obeys the
 * same rule as every other one here — see tests/tenancy/scoping.test.ts.
 */
export async function trialConsumption(orgId: string): Promise<TrialConsumption> {
  const row = await queryOne<{ seconds: string; cues: string }>(
    `select coalesce(sum(units_in) filter (where kind = $2), 0) as seconds,
            coalesce(sum(cues)     filter (where kind = $3), 0) as cues
       from usage_events
      where org_id = $1`,
    [requireOrg(orgId), 'transcribe' satisfies UsageKind, 'translate' satisfies UsageKind],
  )
  return {
    transcribeSeconds: Number(row?.seconds ?? 0),
    translatedCues: Number(row?.cues ?? 0),
  }
}

export interface UsageByMonth {
  month: string
  kind: UsageKind
  model: string | null
  units_in: string
  units_out: string
  cost_usd: string
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
            count(*)       as calls
       from usage_events
      where org_id = $1
        and created_at >= date_trunc('month', now()) - make_interval(months => $2::int)
      group by 1, 2, 3
      order by 1 desc, 6 desc`,
    [requireOrg(orgId), months],
  )
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
