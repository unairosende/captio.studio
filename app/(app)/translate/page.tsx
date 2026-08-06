import { requireOrgContext, requireUser } from '@/lib/auth/session'
import { getLiveSubscription } from '@/lib/db/billing'

import TranslateClient from './TranslateClient'

/**
 * The editor.
 *
 * No auth check of its own: app/(app)/layout.tsx already refuses anyone without
 * a session and an organisation. Repeating it here is how the two drift apart
 * and one of them ends up wrong — which is exactly what the old Supabase check
 * did once the layout landed: it sent people holding a valid session back to
 * the login page.
 */
export default async function TranslatePage() {
  const [{ orgId }, user] = await Promise.all([requireOrgContext(), requireUser()])

  // Deliberately not a paywall yet. Billing is not wired, so gating on an
  // active subscription would lock every new organisation out of the product
  // the moment it finished signing up. The gate goes in with the trial rules,
  // not before them.
  const subscription = await getLiveSubscription(orgId)

  return <TranslateClient user={{ email: user.email }} plan={subscription?.plan ?? 'free'} />
}
