import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { paywallResponse, remainingFrom, type Allowance } from '../../lib/entitlement.ts'
import { TRIAL } from '../../lib/plans.ts'

/**
 * The trial is the only thing standing between an open signup form and our
 * provider bill, so its arithmetic is worth pinning down.
 *
 * Both directions matter. Letting a used-up trial through costs money on every
 * account that notices; stopping a paying customer costs the customer.
 */

describe('what is left of the trial', () => {
  const FULL = TRIAL.mediaMinutes * 60

  it('starts at the full allowance', () => {
    assert.deepEqual(remainingFrom(0), { mediaSeconds: FULL })
  })

  /**
   * One pool, spent by transcription and translation alike. The two used to be
   * separate promises measured in different units, which meant a customer could
   * exhaust the one they were not watching without warning.
   */
  it('spends transcription and translation from the same pool', () => {
    assert.equal(remainingFrom(600).mediaSeconds, FULL - 600)
  })

  it('never reports a negative remainder', () => {
    // A job is allowed to overrun its allowance, so consumption above the limit
    // is expected rather than exceptional. Showing "-6 minutes left" reads as a
    // debt, which is not what was sold.
    assert.equal(remainingFrom(FULL + 380).mediaSeconds, 0)
  })
})

describe('the wall', () => {
  const exhausted = (kind: Allowance['kind']): Allowance => ({
    allowed: false,
    status: 'exhausted',
    kind,
    remaining: { mediaSeconds: 0 },
    // No plan behind this one; the plan's own wall is in plan-limit.test.ts.
    monthly: null,
  })

  it('answers 402, not 403', async () => {
    // Nothing is wrong with who they are, only with what they have left. A 403
    // would send a ready-to-pay customer to support instead of to checkout.
    const res = paywallResponse(exhausted('translate'))

    assert.equal(res.status, 402)
    assert.equal((await res.json()).upgradeUrl, '/pricing')
  })

  /**
   * One pool means one sentence. The message used to name whichever of two
   * limits had run out, and that distinction is gone on purpose: transcription
   * and translation spend the same minutes, so telling somebody which of them
   * emptied the pool would be describing an accounting that no longer exists.
   */
  it('names the minutes that ran out, whichever job asked', async () => {
    const audio = await paywallResponse(exhausted('transcribe')).json()
    const subtitles = await paywallResponse(exhausted('translate')).json()

    assert.match(audio.error, new RegExp(`${TRIAL.mediaMinutes} minutes`))
    assert.equal(audio.error, subtitles.error)
  })

  it('says the work is still theirs', async () => {
    // The promise made when the trial was chosen: exhausted stops new AI calls
    // and nothing else. If this sentence goes, read-only access stops being
    // discoverable by anyone who hits the wall.
    const body = await paywallResponse(exhausted('translate')).json()

    assert.match(body.error, /export/i)
  })
})
