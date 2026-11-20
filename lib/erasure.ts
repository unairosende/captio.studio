import { latestSubscription } from './db/billing.ts'
import { allStorageKeys, projectStorageKeys, sequenceStorageKeys } from './db/media.ts'
import { deleteOrganization } from './db/organizations.ts'
import { deleteProject } from './db/projects.ts'
import { deleteSequence } from './db/sequences.ts'
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

  // 2 · Clear the bucket. 3 · Only now the rows, and only if it is actually clear.
  const objectsDeleted = await clearObjects(await allStorageKeys(orgId), `org ${orgId}`)
  await deleteOrganization(orgId)

  return { objectsDeleted, subscriptionCanceled }
}

/**
 * A project, or a sequence, with the audio and video behind it.
 *
 * The same order as an organisation, for the same reason: the cascade takes the
 * media rows with the sequences, and with them the only record of which keys
 * exist. Before this, deleting a project left its video in the bucket for ever,
 * unreachable by the sweep and by erasure alike. False when the row was not
 * there, as deleteProject and deleteSequence answer.
 */
export async function eraseProject(orgId: string, projectId: string): Promise<boolean> {
  await clearObjects(await projectStorageKeys(orgId, projectId), `project ${projectId}`)
  return deleteProject(orgId, projectId)
}

export async function eraseSequence(orgId: string, sequenceId: string): Promise<boolean> {
  await clearObjects(await sequenceStorageKeys(orgId, sequenceId), `sequence ${sequenceId}`)
  return deleteSequence(orgId, sequenceId)
}

/**
 * Delete these objects, or throw before any row is touched.
 *
 * deleteObject is idempotent (S3 answers 204 whether or not the key was there),
 * so a retry re-deletes the gone ones harmlessly and finishes the rest.
 */
async function clearObjects(keys: string[], owner: string): Promise<number> {
  if (!r2Config()) return 0
  let deleted = 0
  let failed = 0
  for (const key of keys) {
    if (await deleteObject(key)) deleted++
    else failed++
  }
  if (failed > 0) {
    throw new Error(
      `erasure: ${failed} object(s) refused to delete for ${owner}; ` +
        'leaving it intact so the erasure can be retried',
    )
  }
  return deleted
}
