import assert from 'node:assert/strict'
import { it } from 'node:test'

/**
 * A private copy run by the productora that pays its own providers bills
 * nobody, so nobody there should ever meet the wall.
 *
 * The flag is read when the module loads, which is why it is set before the
 * import rather than inside the test. node --test gives each file its own
 * process, so this cannot leak into the trial and plan tests next door.
 */
process.env.NEXT_PUBLIC_BILLING = 'off'
const { allowanceFor, getEntitlement } = await import('../../lib/entitlement.ts')

it('gives every organisation the uncapped grant without asking the database', async () => {
  // Without DATABASE_URL, any query would throw: passing proves none was made.
  const entitlement = await getEntitlement('org-nobody-created')

  assert.deepEqual(entitlement, { status: 'subscribed', plan: 'ilimitado', remaining: null, monthly: null })
  assert.equal(allowanceFor(entitlement, 'transcribe').allowed, true)
  assert.equal(allowanceFor(entitlement, 'translate').allowed, true)
})
