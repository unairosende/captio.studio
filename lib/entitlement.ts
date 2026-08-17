import type { Plan } from '@/types/subtitle'

import {
  currentMonthCues,
  getLiveSubscription,
  trialConsumption,
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
 * Two ceilings, not one. The trial is an amount that never refills; a paid plan
 * is an amount every calendar month. Both are real limits: a subscription with
 * no ceiling is an open bar at our expense, because every translated cue is a
 * provider call we pay for and 19 EUR buys a finite number of them.
 */

export interface TrialRemaining {
  transcribeSeconds: number
  translatedCues: number
}

/**
 * What a paid plan has left of the current calendar month.
 *
 * Denominated in subtitles because that is what the plans are sold in — the
 * figure printed on /pricing comes from the same `monthlySubtitles` this is
 * built from, so the promise and the wall cannot drift apart.
 */
export interface MonthlyAllowance {
  /** The plan's name, for the message that has to say which plan ran out. */
  plan: string
  /** Subtitles the plan includes each month. */
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
export function remainingFrom(used: {
  transcribeSeconds: number
  translatedCues: number
}): TrialRemaining {
  return {
    // Clamped at zero: a job is allowed to overshoot its allowance (see below),
    // and a negative remainder shown to a customer reads as a debt they owe.
    transcribeSeconds: Math.max(0, TRIAL.transcribeSeconds - used.transcribeSeconds),
    translatedCues: Math.max(0, TRIAL.translatedCues - used.translatedCues),
  }
}

/** What is left of a plan's month. Pure, for the same reason as above. */
export function monthlyFrom(plan: Plan, used: number): MonthlyAllowance {
  return {
    plan: plan.name,
    limit: plan.monthlySubtitles,
    used,
    remaining: Math.max(0, plan.monthlySubtitles - used),
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
      monthly: plan ? monthlyFrom(plan, await currentMonthCues(orgId)) : null,
    }
  }
  return {
    status: 'trial',
    plan: 'free',
    remaining: remainingFrom(await trialConsumption(orgId)),
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
 */
export function allowanceFor(entitlement: Entitlement, kind: UsageKind): Allowance {
  if (entitlement.status === 'subscribed') {
    const { monthly } = entitlement

    // Only translation is denominated in subtitles. The plans promise a number
    // of subtitles a month and say nothing about hours of audio, so refusing an
    // upload here would enforce a limit nobody was ever sold.
    //
    // Same "is there anything left" test as the trial below, for the same
    // reason: refusing a 500-cue batch because 400 remain is worse than one
    // bounded overrun.
    const over = kind === 'translate' && monthly !== null && monthly.remaining <= 0

    return {
      allowed: !over,
      status: over ? 'over-plan' : 'subscribed',
      kind,
      remaining: null,
      monthly,
    }
  }

  const { remaining } = entitlement

  // Checked against the matching limit only: the two are separate promises, and
  // running out of audio minutes must not block translating an imported file.
  //
  // The test is "is there anything left", not "is there enough". How long an
  // audio file runs cannot be known until the provider has already transcribed
  // it, and refusing a 500-cue batch because 400 remain would be a worse
  // experience than letting the last job run over. The overshoot is bounded by
  // one job, and one job is cheaper than the support conversation.
  const left = kind === 'transcribe' ? remaining.transcribeSeconds : remaining.translatedCues

  return {
    allowed: left > 0,
    status: left > 0 ? 'trial' : 'exhausted',
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
  const what =
    allowance.kind === 'transcribe'
      ? `the ${TRIAL.transcribeSeconds / 3600} hour of transcription`
      : `the ${TRIAL.translatedCues.toLocaleString('en-GB')} translated subtitles`

  const error =
    allowance.status === 'over-plan' && allowance.monthly
      ? `Your ${allowance.monthly.plan} plan includes ` +
        `${allowance.monthly.limit.toLocaleString('en-GB')} translated subtitles a month, ` +
        'and this month is spent. The allowance starts again at the beginning of next month, ' +
        'or a larger plan raises it now — your projects stay where they are and can still be exported.'
      : `Your free trial has used ${what} it includes. ` +
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
