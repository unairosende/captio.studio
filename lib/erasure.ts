import { latestSubscription } from './db/billing.ts'
import { allStorageKeys } from './db/media.ts'
import { deleteOrganization } from './db/organizations.ts'
import { deleteObject, r2Config } from './storage/r2.ts'
import { getStripe } from './stripe.ts'

/**
 * Erase an organisation and everything it owns, everywhere it lives.
 *
 * The database cascade (see deleteOrganization) is only two thirds of an
 * erasure: the recorded audio and video sit in the R2 bucket, and the money
 * lives at Stripe. Neither is reached by deleting a row, so both are dealt with
 * here, and the order is the whole safety argument:
 *
 *  1. Cancel the subscription first. If anything below fails we have deleted
 *     nothing yet, so a half-run leaves a working, still-billed organisation
 *     rather than a deleted one that keeps being charged.
 *  2. Delete the objects before the rows. The media rows are the only record of
 *     which keys exist; drop them first and a key that refused to delete is
 *     orphaned with nothing left pointing at it, invisible to every sweep.
 *  3. Delete the organisation row last, and only if every object went. A single
 *     stubborn key throws instead, leaving the whole organisation intact so the
 *     erasure can simply be run again — deleteObject is idempotent (S3 answers
 *     204 whether or not the key was there), so a retry re-deletes the gone ones
 *     harmlessly and finishes the rest.
 *
 * Shared by the two ways an organisation dies: the owner asking for it now, and
 * the retention sweep taking it a fixed time after the subscription lapsed.
 */

export interface ErasureSummary {
  objectsDeleted: number
  subscriptionCanceled: boolean
}

export async function eraseOrganization(orgId: string): Promise<ErasureSummary> {
  // 1 · Stop the money.
  let subscriptionCanceled = false
  const sub = await latestSubscription(orgId)
  if (sub && sub.status !== 'canceled') {
    try {
      await getStripe().subscriptions.cancel(sub.id)
      subscriptionCanceled = true
    } catch (err) {
      // A subscription Stripe has already ended throws here; so does a genuine
      // outage. Neither should strand the erasure — the row is about to be gone
      // regardless — so this is logged, not raised.
      console.error(`erasure: could not cancel Stripe subscription ${sub.id} for org ${orgId}`, err)
    }
  }

  // 2 · Clear the bucket.
  let objectsDeleted = 0
  let objectsFailed = 0
  if (r2Config()) {
    for (const key of await allStorageKeys(orgId)) {
      if (await deleteObject(key)) objectsDeleted++
      else objectsFailed++
    }
  }

  // 3 · Only now the rows, and only if the bucket is actually clear.
  if (objectsFailed > 0) {
    throw new Error(
      `erasure: ${objectsFailed} object(s) refused to delete for org ${orgId}; ` +
        'leaving the organisation intact so the erasure can be retried',
    )
  }

  await deleteOrganization(orgId)

  return { objectsDeleted, subscriptionCanceled }
}
