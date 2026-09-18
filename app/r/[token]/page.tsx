import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import DeadLink from '@/components/review/DeadLink'
import GuestBadge from '@/components/review/GuestBadge'
import GuestGate from '@/components/review/GuestGate'
import s from '@/components/review/review.module.css'
import { guestCookie, resolveGuest, resolveLink } from '@/lib/auth/actor'
import { getOrganization } from '@/lib/db/organizations'
import { getProject } from '@/lib/db/projects'
import { touchGuest } from '@/lib/db/review-links'
import { listSequences } from '@/lib/db/sequences'
import { describeSequence } from '@/lib/lang'

/**
 * Where a review link lands: the project it opens, and the sequences in it.
 *
 * Public by design — see proxy.ts. The token in the URL is the credential, and
 * every read below is scoped by the organisation the token resolved to on the
 * server. A dead link (revoked, expired, never existed) is one page for all
 * three cases: saying which would tell a stranger which tokens were once real.
 */

export const metadata: Metadata = { title: 'Revisión de subtítulos · Captio' }

interface Props {
  params: Promise<{ token: string }>
}

export default async function ReviewLinkPage({ params }: Props) {
  const { token } = await params
  const link = await resolveLink(token)
  if (!link) return <DeadLink />

  const [project, organization] = await Promise.all([
    getProject(link.org_id, link.project_id),
    getOrganization(link.org_id),
  ])
  if (!project) return <DeadLink />

  const organizationName = organization?.name ?? 'Una productora'
  const guest = await resolveGuest(link, (await cookies()).get(guestCookie(link.id))?.value)
  if (!guest) {
    return <GuestGate token={token} projectName={project.name} organizationName={organizationName} />
  }

  const [sequences] = await Promise.all([
    listSequences(link.org_id, link.project_id),
    touchGuest(link.org_id, guest.id),
  ])
  const count = sequences.length

  return (
    <div className={`v2 ${s.page}`}>
      <header className="topbar">
        <span className="brand">captio</span>
        <span className="topbar-sep" />
        <span className={s.org}>{organizationName}</span>
        <div className={s.headEnd}>
          <GuestBadge token={token} name={guest.name} email={guest.email} />
        </div>
      </header>

      <main className={s.main}>
        <h1 className={s.title}>{project.name}</h1>
        <p className={s.meta}>
          {link.label ? `${link.label} · ` : ''}
          {count === 1 ? '1 secuencia para revisar' : `${count} secuencias para revisar`}
          {link.can_edit ? ' · puedes comentar y corregir el texto' : ' · puedes comentar'}
        </p>

        {count === 0 ? (
          <div className="empty">
            <span className="empty-title">Nada que revisar todavía</span>
            <p>Cuando {organizationName} guarde una secuencia en este proyecto, aparecerá aquí.</p>
          </div>
        ) : (
          <div className={s.grid}>
            {sequences.map(q => (
              <Link key={q.id} href={`/r/${token}/${q.id}`} className={`card ${s.seq}`}>
                <span className={s.seqName}>{q.name}</span>
                <span className={s.seqMeta}>{describeSequence(q)}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
