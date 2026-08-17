import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { costUsd } from '../../lib/pricing.ts'

/**
 * The only place a provider's rates are turned into a number this product will
 * act on, so its arithmetic is worth pinning down.
 *
 * Both directions matter, and neither is loud when it goes wrong. Under-counting
 * lets an account spend past whatever quota is enforced against `cost_usd`;
 * over-counting stops a customer who has spent nothing like that much. A row
 * saying zero looks exactly like a row nobody charged us for.
 */

/** The table from .env.local.example, which is the shape production uses. */
const PRICES = JSON.stringify({
  'gemini-3.6-flash': { inPerMTok: 0.3, outPerMTok: 2.5 },
  scribe_v2: { perHour: 0.22 },
})

const withPrices = (raw: string | undefined) => {
  if (raw === undefined) delete process.env.PRICES
  else process.env.PRICES = raw
}

afterEach(() => withPrices(undefined))

describe('priced by the hour, counted in seconds', () => {
  it('charges an hour of audio at the hourly rate', () => {
    withPrices(PRICES)
    assert.equal(costUsd('scribe_v2', { unitsIn: 3600 }), 0.22)
  })

  it('charges part of an hour pro rata', () => {
    // Nothing rounds up to a whole hour: transcription is billed by duration,
    // and a 30-second clip must not be recorded as a full 22 cents.
    withPrices(PRICES)
    assert.equal(costUsd('scribe_v2', { unitsIn: 1800 }), 0.11)
    assert.equal(costUsd('scribe_v2', { unitsIn: 30 }), 0.001833)
  })

  it('ignores output units for a model with no output price', () => {
    // Keeps the denominations from crossing. Seconds and tokens are both plain
    // numbers by the time they arrive here, and only the model says which.
    withPrices(PRICES)
    assert.equal(costUsd('scribe_v2', { unitsIn: 3600, unitsOut: 50_000 }), 0.22)
  })
})

describe('priced per million tokens', () => {
  it('bills input and output at their own rates', () => {
    withPrices(PRICES)
    // 200k in at $0.30/Mtok = $0.06; 40k out at $2.50/Mtok = $0.10.
    assert.equal(costUsd('gemini-3.6-flash', { unitsIn: 200_000, unitsOut: 40_000 }), 0.16)
  })

  it('does not charge output as input', () => {
    // Output costs eight times input here, so swapping the two is a multi-fold
    // error rather than a rounding difference — and silent either way.
    withPrices(PRICES)
    assert.notEqual(
      costUsd('gemini-3.6-flash', { unitsIn: 200_000, unitsOut: 40_000 }),
      costUsd('gemini-3.6-flash', { unitsIn: 40_000, unitsOut: 200_000 }),
    )
  })

  it('rounds to the precision the column stores', () => {
    // usage_events.cost_usd is numeric(12,6). A single token costs less than
    // that, and reporting a figure the row cannot hold makes the two disagree
    // for no benefit.
    withPrices(PRICES)
    assert.equal(costUsd('gemini-3.6-flash', { unitsIn: 1 }), 0)
  })
})

describe('when the price is not known', () => {
  it('records zero for a model missing from the table', () => {
    // The translation fallback is the real case: a batch served by Groq is
    // metered, but nothing in PRICES names it, and a guess in this column would
    // be indistinguishable from a figure somebody can invoice against.
    withPrices(PRICES)
    assert.equal(costUsd('llama-3.3-70b-versatile', { unitsIn: 200_000, unitsOut: 40_000 }), 0)
  })

  it('records zero when PRICES is unset', () => {
    withPrices(undefined)
    assert.equal(costUsd('scribe_v2', { unitsIn: 3600 }), 0)
  })

  it('survives a malformed PRICES', () => {
    // Read on the way to a metering write. Throwing here would turn a typo in an
    // environment variable into a failed transcription the provider has already
    // charged us for.
    withPrices('{"scribe_v2":{"perHour":0.22}')
    assert.equal(costUsd('scribe_v2', { unitsIn: 3600 }), 0)
  })

  it('records zero for a call with no model', () => {
    withPrices(PRICES)
    assert.equal(costUsd(null, { unitsIn: 3600 }), 0)
  })
})

describe('missing counts', () => {
  it('spends nothing for units nobody reported', () => {
    // Scribe never reports duration, so unitsIn comes from the last word's
    // timestamp — which an empty transcript does not have.
    withPrices(PRICES)
    assert.equal(costUsd('scribe_v2', {}), 0)
    assert.equal(costUsd('gemini-3.6-flash', { unitsIn: 200_000 }), 0.06)
  })
})
