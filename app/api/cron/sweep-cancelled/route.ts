import { NextResponse, type NextRequest } from 'next/server'

import { authorizeCron } from '@/lib/cron'
import { listMembers } from '@/lib/db/organizations'
import {
  markRetentionWarned,
  orgsDueForErasure,
  orgsDueForRetentionWarning,
} from '@/lib/db/retention'
import { retentionWarningEmail, sendMail } from '@/lib/email/send'
import { eraseOrganization } from '@/lib/erasure'
import { RETENTION_DAYS } from '@/lib/retention'

/**
 * Retire organisations whose subscription lapsed and never came back.
 *
 * Two passes, in order. First the warning: organisations near the end of the
 * window whose owners have not been told, each sent one message naming the date
 * their work goes. Only then, in the same run for a different set, the erasure:
 * organisations past the window whose warning has had time to land, handed to
 * lib/erasure.ts to have their bucket, billing and rows cleared together.
 *
 * The order is deliberate — an org can never be warned and erased in one run,
 * because the erasure pass requires a warning sent days ago, which no org the
 * warning pass just touched can satisfy.
 *
 * maxDuration is raised because erasing an organisation is one DELETE per stored
 * object, and a lapsed customer with a back catalogue has many.
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // ── Warn ───────────────────────────────────────────────────────────────
  let warned = 0
  for (const org of await orgsDueForRetentionWarning()) {
    const deleteOn = new Date(
      new Date(org.currentPeriodEnd).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

    const owners = (await listMembers(org.orgId)).filter(m => m.role === 'owner')

    let anySent = false
    for (const owner of owners) {
      const sent = await sendMail({
        to: owner.email,
        ...retentionWarningEmail({
          organizationName: org.orgName,
          deleteOn,
          reactivateUrl: `${appUrl}/pricing`,
        }),
      })
      anySent = anySent || sent
    }

    // The clock starts only when a notice actually left. If every owner address
    // failed, retention_warned_at stays null and this org comes back tomorrow —
    // erasure without a delivered warning is the one thing this must never do.
    // Ceiling: an org whose owners' mail permanently bounces is never
    // auto-erased, which is the safe direction to fail in.
    if (anySent) {
      await markRetentionWarned(org.subId)
      warned++
    }
  }

  // ── Erase ──────────────────────────────────────────────────────────────
  let erased = 0
  let failed = 0
  for (const org of await orgsDueForErasure()) {
    try {
      await eraseOrganization(org.orgId)
      erased++
    } catch (err) {
      // A stubborn object leaves the org intact on purpose (see lib/erasure.ts);
      // it is picked up again next run rather than half-deleted now.
      console.error(`retention: could not erase org ${org.orgId}`, err)
      failed++
    }
  }

  return NextResponse.json({ warned, erased, failed })
}
