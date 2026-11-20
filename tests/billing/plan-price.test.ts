import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * The webhook reads the plan from the subscription's price, because switching
 * plan in the portal changes the price and leaves checkout's metadata behind.
 * Reading the metadata kept a customer who moved to Studio on Individual's
 * minutes and seats.
 *
 * PLANS reads the price ids from the environment when the module loads, so they
 * are set first and the module is imported afterwards.
 */
process.env.STRIPE_PRICE_INDIVIDUAL = 'price_individual_test'
process.env.STRIPE_PRICE_TEAM = 'price_team_test'
const { planForPrice } = await import('../../lib/plans.ts')

describe('planForPrice', () => {
  it('names the plan each price sells', () => {
    assert.equal(planForPrice('price_individual_test')?.id, 'individual')
    assert.equal(planForPrice('price_team_test')?.id, 'team')
  })

  it('knows nothing of a price that is not ours', () => {
    assert.equal(planForPrice('price_someone_else'), undefined)
  })

  // An unset STRIPE_PRICE_* leaves stripePriceId empty; a missing price must not
  // match it and quietly become that plan.
  it('does not match a missing price to an unconfigured plan', () => {
    assert.equal(planForPrice(undefined), undefined)
    assert.equal(planForPrice(''), undefined)
  })
})
