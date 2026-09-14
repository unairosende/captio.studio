import { cookies } from 'next/headers'
import Link from 'next/link'

import DeadLink from '@/components/review/DeadLink'
import GuestBadge from '@/components/review/GuestBadge'
import GuestGate from '@/components/review/GuestGate'
import { guestCookie, resolveGuest, resolveLink } from '@/lib/auth/actor'
import { getOrganization } from '@/lib/db/organizations'
import { getProject } from '@/lib/db/projects'
import { touchGuest } from '@/lib/db/review-links'
import { listSequences } from '@/lib/db/sequences'
import { LANG_CODES } from '@/lib/providers'

/**
 * Where a review link lands: the project it opens, and the sequences in it.
 *
 * Public by design — see proxy.ts. The token in the URL is the credential, and
 * every read below is scoped by the organisation the token resolved to on the
 * server. A dead link (revoked, expired, never existed) is one page for all
 * three cases: saying which would tell a stranger which tokens were once real.
 */

interface Props {
  params: Promise<{ token: string }>
}

const short = (lang: string | null): string => (lang ? (LANG_CODES[lang] ?? lang) : '—')

export default async function ReviewLinkPage({ params }: Props) {
  const { token } = await params
  const link = await resolveLink(token)
  if (!link) return <DeadLink />

  const [project, organization] = await Promise.all([
    getProject(link.org_id, link.project_id),
    getOrganization(link.org_id),
  ])
  if (!project) return <DeadLink />

  const guest = await resolveGuest(link, (await cookies()).get(guestCookie(link.id))?.value)
  if (!guest) {
    return (
      <GuestGate
        token={token}
        projectName={project.name}
        organizationName={organization?.name ?? 'A production company'}
      />
    )
  }

  const [sequences] = await Promise.all([
    listSequences(link.org_id, link.project_id),
    touchGuest(link.org_id, guest.id),
  ])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <span className="muted">{organization?.name}</span>
        <div style={{ marginLeft: 'auto' }}>
          <GuestBadge token={token} name={guest.name} email={guest.email} />
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '22px 16px 60px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>{project.name}</h1>
        <div className="muted" style={{ marginBottom: 20 }}>
          {link.label ? `${link.label} · ` : ''}
          {sequences.length} sequence{sequences.length === 1 ? '' : 's'} to review
          {link.can_edit ? ' · you can comment and correct the text' : ' · you can comment'}
        </div>

        {sequences.length === 0 ? (
          <div className="card muted" style={{ textAlign: 'center', padding: '38px 16px' }}>
            Nothing to review yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 12 }}>
            {sequences.map(s => (
              <Link
                key={s.id}
                href={`/r/${token}/${s.id}`}
                className="card"
                style={{ display: 'block', padding: '13px 15px', textDecoration: 'none' }}
              >
                <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </div>
                <div className="muted" style={{ fontFamily: 'var(--mono)', marginTop: 5 }}>
                  {s.cue_count.toLocaleString('en-GB')} cues · {short(s.source_lang)}
                  {s.target_langs.length > 0 && ` → ${s.target_langs.map(short).join(' ')}`}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
