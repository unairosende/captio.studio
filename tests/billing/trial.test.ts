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
  it('starts at the full allowance', () => {
    assert.deepEqual(remainingFrom({ transcribeSeconds: 0, translatedCues: 0 }), {
      transcribeSeconds: TRIAL.transcribeSeconds,
      translatedCues: TRIAL.translatedCues,
    })
  })

  it('spends each limit separately', () => {
    // Running out of audio must not touch the subtitle allowance: somebody who
    // imports their own SRT never transcribes anything at all.
    const left = remainingFrom({
      transcribeSeconds: TRIAL.transcribeSeconds,
      translatedCues: 10,
    })

    assert.equal(left.transcribeSeconds, 0)
    assert.equal(left.translatedCues, TRIAL.translatedCues - 10)
  })

  it('never reports a negative remainder', () => {
    // A job is allowed to overrun its allowance, so consumption above the limit
    // is expected rather than exceptional. Showing "-380 subtitles left" reads
    // as a debt, which is not what was sold.
    const left = remainingFrom({
      transcribeSeconds: TRIAL.transcribeSeconds * 3,
      translatedCues: TRIAL.translatedCues + 380,
    })

    assert.equal(left.transcribeSeconds, 0)
    assert.equal(left.translatedCues, 0)
  })
})

describe('the wall', () => {
  const exhausted = (kind: Allowance['kind']): Allowance => ({
    allowed: false,
    status: 'exhausted',
    kind,
    remaining: { transcribeSeconds: 0, translatedCues: 0 },
  })

  it('answers 402, not 403', async () => {
    // Nothing is wrong with who they are, only with what they have left. A 403
    // would send a ready-to-pay customer to support instead of to checkout.
    const res = paywallResponse(exhausted('translate'))

    assert.equal(res.status, 402)
    assert.equal((await res.json()).upgradeUrl, '/pricing')
  })

  it('names the limit that ran out', async () => {
    const audio = await paywallResponse(exhausted('transcribe')).json()
    const subtitles = await paywallResponse(exhausted('translate')).json()

    assert.match(audio.error, /transcription/i)
    assert.match(subtitles.error, /subtitles/i)
    assert.notEqual(audio.error, subtitles.error)
  })

  it('says the work is still theirs', async () => {
    // The promise made when the trial was chosen: exhausted stops new AI calls
    // and nothing else. If this sentence goes, read-only access stops being
    // discoverable by anyone who hits the wall.
    const body = await paywallResponse(exhausted('translate')).json()

    assert.match(body.error, /export/i)
  })
})
