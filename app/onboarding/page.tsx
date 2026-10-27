import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth/server'
import { pendingInvitationFor } from '@/lib/db/organizations'

import { CreateOrganization } from './CreateOrganization'

/**
 * Where a new account lands.
 *
 * Deliberately outside the (app) group: that layout requires an organisation,
 * and this is the page people reach precisely because they do not have one yet.
 */
export default async function OnboardingPage() {
  const h = await headers()

  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) redirect('/login')

  // Someone who already belongs somewhere has no business here — arriving by
  // back button or a stale bookmark should not create a second organisation.
  const orgs = await auth.api.listOrganizations({ headers: h }).catch(() => [])
  if (orgs.length > 0) redirect('/dashboard')

  // Somebody invited arrives here after confirming their address, with
  // nothing left to say where they were going. A productora of their own would
  // leave the one that invited them waiting, so the invitation comes first.
  const invitation = await pendingInvitationFor(session.user.email)
  if (invitation) redirect(`/accept-invitation/${invitation}`)

  return <CreateOrganization suggestedName={session.user.name ?? ''} />
}
