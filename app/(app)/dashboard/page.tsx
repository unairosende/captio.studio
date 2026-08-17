import { requireOrgContext, requireUser } from '@/lib/auth/session'
import { getLiveSubscription, usageByMonth } from '@/lib/db/billing'
import { countPendingInvitations, getOrganization, listMembers } from '@/lib/db/organizations'
import { listProjects } from '@/lib/db/projects'
import { getEntitlement } from '@/lib/entitlement'
import { summariseUsage } from '@/lib/usage'

import DashboardClient from './DashboardClient'

/**
 * Where signing in now lands.
 *
 * Until this existed the front door was the editor: a customer arrived at an
 * empty timeline, with their work behind a dropdown in the toolbar and nothing
 * anywhere saying which organisation they were in, what the trial had left, or
 * who else could see their projects. All of it was already in the database.
 *
 * No auth check of its own — app/(app)/layout.tsx refuses anyone without a
 * session and an organisation before this renders. See the note in
 * translate/page.tsx for what happened the last time a page checked twice.
 */

/** Long enough to see a busy month against a quiet one, short enough to stay a list. */
const HISTORY_MONTHS = 6

export default async function DashboardPage() {
  const [{ orgId, userId, role }, user] = await Promise.all([requireOrgContext(), requireUser()])

  // One round rather than seven sequential awaits. They are independent reads
  // against the same pool, and this page is the first thing a customer sees
  // after typing their password.
  const [organization, projects, members, pendingInvitations, entitlement, subscription, usage] =
    await Promise.all([
      getOrganization(orgId),
      listProjects(orgId),
      listMembers(orgId),
      countPendingInvitations(orgId),
      getEntitlement(orgId),
      getLiveSubscription(orgId),
      usageByMonth(orgId, HISTORY_MONTHS),
    ])

  return (
    <DashboardClient
      user={{ id: userId, email: user.email, role }}
      organizationName={organization?.name ?? 'Your organisation'}
      projects={projects}
      members={members}
      pendingInvitations={pendingInvitations}
      entitlement={entitlement}
      subscription={
        subscription && {
          plan: subscription.plan,
          status: subscription.status,
          seats: subscription.seats,
          currentPeriodEnd: subscription.current_period_end,
        }
      }
      usage={summariseUsage(usage)}
    />
  )
}
