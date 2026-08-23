import type { Plan } from '@/types/subtitle'

import {
  currentMonthMediaSeconds,
  getLiveSubscription,
  trialMediaSeconds,
  type UsageKind,
} from './db/billing.ts'
import { PLANS, TRIAL } from './plans.ts'

/**
 * Whether an organisation may run another AI job, and why not.
 *
 * Deliberately the only place that answers this. A paywall spread across three
 * routes is a paywall with a hole in it, and the hole is always in the route
 * somebody added last.
 *
 * ONE POOL, DENOMINATED IN MINUTES OF MATERIAL.
 *
 * There used to be two ceilings measured in different things — hours of audio
 * for the trial, subtitles a month for a plan — and paid transcription was
 * capped by neither. A customer could therefore transcribe without limit at our
 * expense, and nothing on the pricing page said otherwise.
 *
 * Minutes fix both. It is the unit a producer can estimate before starting, the
 * unit every competitor quotes, and the one that covers transcription and
 * translation alike, because both spend the same material.
 *
 * Charged once per piece of material, however many languages follow — see
 * db/migrations/0008. Nothing here has to know that: the counter cannot be set
 * twice, so "every language included" holds even for a caller who never read
 * this file.
 */

export interface TrialRemaining {
  /** Seconds of material the trial has left. */
  mediaSeconds: number
}

/**
 * What a paid plan has left of the current calendar month.
 *
 * Denominated in minutes because that is what the plans are sold in — the
 * figure printed on /pricing comes from the same `monthlyMediaMinutes` this is
 * built from, so the promise and the wall cannot drift apart.
 */
export interface MonthlyAllowance {
  /** The plan's name, for the message that has to say which plan ran out. */
  plan: string
  /** Minutes of material the plan includes each month. */
  limit: number
  used: number
  /** Clamped at zero, for the same reason the trial's remainder is. */
  remaining: number
}

export interface Allowance {
  allowed: boolean
  status: 'subscribed' | 'trial' | 'exhausted' | 'over-plan'
  /** What was being asked for — the message depends on it. */
  kind: UsageKind
  /** Null when a subscription, rather than the trial, is what is being spent. */
  remaining: TrialRemaining | null
  /** Null on the trial, and on a subscription naming a plan we cannot price. */
  monthly: MonthlyAllowance | null
}

/** What is left of the trial. Pure, so the arithmetic is testable on its own. */
export function remainingFrom(usedSeconds: number): TrialRemaining {
  return {
    // Clamped at zero: a job is allowed to overshoot its allowance (see below),
    // and a negative remainder shown to a customer reads as a debt they owe.
    mediaSeconds: Math.max(0, TRIAL.mediaMinutes * 60 - usedSeconds),
  }
}

/** What is left of a plan's month, in minutes. Pure, for the same reason. */
export function monthlyFrom(plan: Plan, usedSeconds: number): MonthlyAllowance {
  // Rounded up, so nobody is told they have minutes left that are really
  // seconds, and so this figure agrees with the one an invoice would show.
  const used = Math.ceil(usedSeconds / 60)
  return {
    plan: plan.name,
    limit: plan.monthlyMediaMinutes,
    used,
    remaining: Math.max(0, plan.monthlyMediaMinutes - used),
  }
}

/**
 * Where an organisation stands, without asking about a particular job.
 *
 * The editor needs this to show what is left *before* anything is spent. A
 * paywall nobody sees coming is the worst moment a product has: the wall
 * arrives at the exact instant somebody was trying to work.
 */
export type Entitlement =
  | { status: 'subscribed'; plan: string; remaining: null; monthly: MonthlyAllowance | null }
  | { status: 'trial'; plan: 'free'; remaining: TrialRemaining; monthly: null }

export async function getEntitlement(orgId: string): Promise<Entitlement> {
  const subscription = await getLiveSubscription(orgId)
  if (subscription) {
    const plan = PLANS.find(p => p.id === subscription.plan)
    return {
      status: 'subscribed',
      plan: subscription.plan,
      remaining: null,
      // A plan string this build cannot price is left uncapped rather than
      // refused. The row is written from a Stripe webhook, so it can name a plan
      // that has since been renamed or retired; walling a paying customer over
      // that costs them their deadline, while letting it through costs us one
      // month of provider spend on one account.
      monthly: plan ? monthlyFrom(plan, await currentMonthMediaSeconds(orgId)) : null,
    }
  }
  return {
    status: 'trial',
    plan: 'free',
    remaining: remainingFrom(await trialMediaSeconds(orgId)),
    monthly: null,
  }
}

export async function checkAllowance(orgId: string, kind: UsageKind): Promise<Allowance> {
  return allowanceFor(await getEntitlement(orgId), kind)
}

/**
 * The decision itself, given where the organisation stands.
 *
 * Split out from the round trip so both walls can be argued about without a
 * database — the trial's and the plan's. It is still only ever called from the
 * API routes: a limit enforced by the component that draws the button is not a
 * limit.
 *
 * The test is "is there anything left", not "is there enough", and it is now the
 * same test for transcription and translation because they share a pool. How
 * long a recording runs is not known until it has been transcribed, so demanding
 * the whole cost up front would refuse work nobody could have measured. The
 * overshoot is bounded by one job, and one job is cheaper than the support
 * conversation it saves.
 */
export function allowanceFor(entitlement: Entitlement, kind: UsageKind): Allowance {
  if (entitlement.status === 'subscribed') {
    const { monthly } = entitlement
    const over = monthly !== null && monthly.remaining <= 0

    return {
      allowed: !over,
      status: over ? 'over-plan' : 'subscribed',
      kind,
      remaining: null,
      monthly,
    }
  }

  const { remaining } = entitlement

  return {
    allowed: remaining.mediaSeconds > 0,
    status: remaining.mediaSeconds > 0 ? 'trial' : 'exhausted',
    kind,
    remaining,
    monthly: null,
  }
}

/**
 * The wall.
 *
 * 402 rather than 403: nothing is wrong with who they are, only with what they
 * have left. The message names what ran out and says the work is still theirs —
 * a spent allowance stops new AI calls and nothing else, so projects still open
 * and still export.
 *
 * One shape for both ceilings, two sentences. A subscriber told their free trial
 * is over would go to support rather than to checkout, and rightly.
 */
export function paywallResponse(allowance: Allowance): Response {
  const error =
    allowance.status === 'over-plan' && allowance.monthly
      ? `Your ${allowance.monthly.plan} plan includes ` +
        `${allowance.monthly.limit.toLocaleString('en-GB')} minutes of material a month, ` +
        'and this month is spent. The allowance starts again at the beginning of next month, ' +
        'or a larger plan raises it now — your projects stay where they are and can still be exported.'
      : `Your free trial has used the ${TRIAL.mediaMinutes} minutes it includes. ` +
        'Subscribe to run new jobs — your projects stay where they are and can still be exported.'

  return Response.json(
    {
      error,
      trial: allowance.remaining,
      monthly: allowance.monthly,
      upgradeUrl: '/pricing',
    },
    { status: 402 },
  )
}
