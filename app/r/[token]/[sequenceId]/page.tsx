import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import DeadLink from '@/components/review/DeadLink'
import ReviewClient from '@/components/review/ReviewClient'
import { guestCookie, resolveGuest, resolveLink } from '@/lib/auth/actor'
import { listComments } from '@/lib/db/comments'
import { getProject } from '@/lib/db/projects'
import { sequenceInProject, touchGuest } from '@/lib/db/review-links'
import { getSequence, listVersions } from '@/lib/db/sequences'
import { readCues } from '@/lib/subtitles/data'

/**
 * One sequence, as the client sees it.
 *
 * The link decides the organisation and the project; the URL names a sequence,
 * which has to be inside that project or it is not found — the same answer as
 * for a sequence that never existed. Everything the view needs is read here,
 * on the server, and the token goes down to the browser only so that it can
 * come back in a header on every request the view makes.
 */

interface Props {
  params: Promise<{ token: string; sequenceId: string }>
  searchParams: Promise<{ cue?: string }>
}

export default async function GuestReviewPage({ params, searchParams }: Props) {
  const [{ token, sequenceId }, { cue }] = await Promise.all([params, searchParams])

  const link = await resolveLink(token)
  if (!link) return <DeadLink />

  const guest = await resolveGuest(link, (await cookies()).get(guestCookie(link.id))?.value)
  if (!guest) redirect(`/r/${token}`)

  if (!(await sequenceInProject(link.org_id, sequenceId, link.project_id))) notFound()

  const [sequence, project, comments, versions] = await Promise.all([
    getSequence(link.org_id, sequenceId),
    getProject(link.org_id, link.project_id),
    listComments(link.org_id, sequenceId),
    listVersions(link.org_id, sequenceId),
    touchGuest(link.org_id, guest.id),
  ])
  if (!sequence || !project) notFound()

  const focus = Number(cue)

  return (
    <ReviewClient
      // Remounted when the server hands over a newer version — after a reload
      // on conflict — so the screen never keeps stale words over fresh data.
      key={sequence.version}
      token={token}
      self={{ guestId: guest.id, name: guest.name }}
      canEdit={link.can_edit}
      canRestore={false}
      back={{ href: `/r/${token}`, label: 'Sequences' }}
      project={{ name: project.name }}
      sequence={{
        id: sequence.id,
        name: sequence.name,
        version: sequence.version,
        sourceLang: sequence.source_lang,
        targetLangs: sequence.target_langs,
        ...readCues(sequence.data),
      }}
      comments={comments}
      versions={versions}
      focusCue={Number.isInteger(focus) && focus > 0 ? focus : undefined}
    />
  )
}
