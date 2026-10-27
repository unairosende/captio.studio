import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { onAllowList } from '../../lib/auth/signup.ts'

/**
 * The list that lets the first owner of a private copy in before anybody can
 * invite them. Too loose and a stranger walks in; too strict and the owner is
 * locked out of the deployment they just paid for.
 */
describe('who is on the sign-up allow list', () => {
  const list = ' unai@keweke.com, @productora.es ,otra.es'

  it('takes a full address, ignoring case and spaces', () => {
    assert.equal(onAllowList('Unai@Keweke.com ', list), true)
  })

  it('takes a domain written with or without its @', () => {
    assert.equal(onAllowList('ana@productora.es', list), true)
    assert.equal(onAllowList('luis@otra.es', list), true)
  })

  it('does not take another address at a domain listed only by one address', () => {
    assert.equal(onAllowList('alguien@keweke.com', list), false)
  })

  it('does not take a domain that merely ends like a listed one', () => {
    assert.equal(onAllowList('x@mala-productora.es', list), false)
    assert.equal(onAllowList('x@sub.otra.es', list), false)
  })

  it('lets nobody in from an empty list', () => {
    assert.equal(onAllowList('unai@keweke.com', ''), false)
    assert.equal(onAllowList('@', ' , '), false)
  })
})
