import { getLiveSubscription, trialConsumption, type UsageKind } from './db/billing.ts'
import { TRIAL } from './plans.ts'

/**
 * Whether an organisation may run another AI job, and why not.
 *
 * Deliberately the only place that answers this. A paywall spread across three
 * routes is a paywall with a hole in it, and the hole is always in the route
 * somebody added last.
 */

export interface TrialRemaining {
  transcribeSeconds: number
  translatedCues: number
}

export interface Allowance {
  allowed: boolean
  status: 'subscribed' | 'trial' | 'exhausted'
  /** What was being asked for — the message depends on it. */
  kind: UsageKind
  /** Null when a paid subscription makes the question moot. */
  remaining: TrialRemaining | null
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

/**
 * Where an organisation stands, without asking about a particular job.
 *
 * The editor needs this to show what is left *before* anything is spent. A
 * paywall nobody sees coming is the worst moment a product has: the wall
 * arrives at the exact instant somebody was trying to work.
 */
export type Entitlement =
  | { status: 'subscribed'; plan: string; remaining: null }
  | { status: 'trial'; plan: 'free'; remaining: TrialRemaining }

export async function getEntitlement(orgId: string): Promise<Entitlement> {
  const subscription = await getLiveSubscription(orgId)
  if (subscription) {
    return { status: 'subscribed', plan: subscription.plan, remaining: null }
  }
  return {
    status: 'trial',
    plan: 'free',
    remaining: remainingFrom(await trialConsumption(orgId)),
  }
}

export async function checkAllowance(orgId: string, kind: UsageKind): Promise<Allowance> {
  const entitlement = await getEntitlement(orgId)
  if (entitlement.status === 'subscribed') {
    return { allowed: true, status: 'subscribed', kind, remaining: null }
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
  }
}

/**
 * The wall.
 *
 * 402 rather than 403: nothing is wrong with who they are, only with what they
 * have left. The message names what ran out and says the work is still theirs —
 * an exhausted trial stops new AI calls and nothing else, so projects still
 * open and still export.
 */
export function paywallResponse(allowance: Allowance): Response {
  const what =
    allowance.kind === 'transcribe'
      ? `the ${TRIAL.transcribeSeconds / 3600} hour of transcription`
      : `the ${TRIAL.translatedCues.toLocaleString('en-GB')} translated subtitles`

  return Response.json(
    {
      error:
        `Your free trial has used ${what} it includes. ` +
        'Subscribe to run new jobs — your projects stay where they are and can still be exported.',
      trial: allowance.remaining,
      upgradeUrl: '/pricing',
    },
    { status: 402 },
  )
}
