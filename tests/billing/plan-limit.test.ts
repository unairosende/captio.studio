import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  allowanceFor,
  monthlyFrom,
  paywallResponse,
  type Entitlement,
} from '../../lib/entitlement.ts'
import { PLANS } from '../../lib/plans.ts'

/**
 * The plans sell a number of subtitles a month, and /pricing prints it. Until
 * this wall existed the number meant nothing: a 19 EUR subscription bought an
 * unbounded amount of provider spend, and the only account we ever refused was
 * one that had not paid.
 *
 * Both directions matter, as with the trial. A ceiling that does not hold is the
 * bug this replaced; one that falls on the wrong job stops a customer who paid.
 */

const individual = PLANS.find(p => p.id === 'individual')!

const subscribed = (used: number): Entitlement => ({
  status: 'subscribed',
  plan: individual.id,
  remaining: null,
  monthly: monthlyFrom(individual, used),
})

describe('what is left of the month a plan includes', () => {
  it('sells a number every plan can be held to', () => {
    // Zero or missing would wall a subscriber on their first job; advertised and
    // unenforced is where this started. Neither is a plan.
    for (const plan of PLANS) {
      assert.ok(plan.monthlySubtitles > 0, `${plan.id} has no monthly allowance`)
    }
  })

  it('starts at the full allowance', () => {
    assert.deepEqual(monthlyFrom(individual, 0), {
      plan: individual.name,
      limit: individual.monthlySubtitles,
      used: 0,
      remaining: individual.monthlySubtitles,
    })
  })

  it('never reports a negative remainder', () => {
    // A job may overshoot its allowance, so consumption above the limit is
    // expected rather than exceptional. "-900 subtitles left" reads as a debt.
    const left = monthlyFrom(individual, individual.monthlySubtitles + 900)

    assert.equal(left.remaining, 0)
    assert.equal(left.used, individual.monthlySubtitles + 900)
  })
})

describe('the plan’s wall', () => {
  it('lets a subscriber with allowance left translate', () => {
    const allowance = allowanceFor(subscribed(10_000), 'translate')

    assert.equal(allowance.allowed, true)
    assert.equal(allowance.status, 'subscribed')
  })

  it('refuses translation once the month is spent', () => {
    const allowance = allowanceFor(subscribed(individual.monthlySubtitles), 'translate')

    assert.equal(allowance.allowed, false)
    assert.equal(allowance.status, 'over-plan')
    assert.equal(allowance.monthly?.remaining, 0)
  })

  it('lets the last job overrun rather than refusing a batch that will not fit', () => {
    // The test is "is there anything left", not "is there enough" — the same
    // rule the trial follows. Refusing a 500-cue batch with 400 left costs more
    // in support than the overrun costs at the provider.
    const allowance = allowanceFor(subscribed(individual.monthlySubtitles - 1), 'translate')

    assert.equal(allowance.allowed, true)
  })

  it('does not stop transcription, which no plan prices in subtitles', () => {
    // The plans promise subtitles a month and say nothing about hours of audio.
    // Refusing an upload here would enforce a limit nobody was sold.
    const allowance = allowanceFor(subscribed(individual.monthlySubtitles * 2), 'transcribe')

    assert.equal(allowance.allowed, true)
    assert.equal(allowance.status, 'subscribed')
  })

  it('leaves a plan it cannot price uncapped rather than walling a payer', () => {
    // A live subscription naming a plan this build does not know — renamed or
    // retired since the Stripe webhook wrote the row. Letting it through costs
    // one account's month of provider spend; refusing costs a paying customer
    // their deadline, for a mistake that is entirely ours.
    const unknown: Entitlement = {
      status: 'subscribed',
      plan: 'legacy_2024',
      remaining: null,
      monthly: null,
    }

    assert.equal(allowanceFor(unknown, 'translate').allowed, true)
  })
})

describe('the wall a subscriber sees', () => {
  const over = () => allowanceFor(subscribed(individual.monthlySubtitles), 'translate')

  it('answers 402 with the same shape the trial uses', async () => {
    const res = paywallResponse(over())

    assert.equal(res.status, 402)
    assert.equal((await res.json()).upgradeUrl, '/pricing')
  })

  it('names the plan and the number that ran out', async () => {
    const body = await paywallResponse(over()).json()

    assert.match(body.error, new RegExp(individual.name))
    assert.match(body.error, new RegExp(individual.monthlySubtitles.toLocaleString('en-GB')))
    assert.equal(body.monthly.limit, individual.monthlySubtitles)
  })

  it('does not tell a paying customer their free trial is over', async () => {
    // They would go to support rather than to checkout, and rightly: they pay.
    const body = await paywallResponse(over()).json()

    assert.doesNotMatch(body.error, /free trial/i)
    assert.match(body.error, /next month/i)
  })

  it('says the work is still theirs', async () => {
    // Same promise the trial makes: a spent allowance stops new AI calls and
    // nothing else.
    const body = await paywallResponse(over()).json()

    assert.match(body.error, /export/i)
  })
})
