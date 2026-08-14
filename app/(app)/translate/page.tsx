import { requireOrgContext, requireUser } from '@/lib/auth/session'
import { getEntitlement } from '@/lib/entitlement'

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

  // Read here rather than from the browser: this page is already a server
  // component doing a round trip, so the editor can render knowing what is left
  // instead of finding out from the first request that gets refused.
  //
  // Not the gate itself. The gate lives in the API routes, because a limit
  // enforced by the page that draws the button is not a limit.
  const entitlement = await getEntitlement(orgId)

  return <TranslateClient user={{ id: user.id, email: user.email }} entitlement={entitlement} />
}
