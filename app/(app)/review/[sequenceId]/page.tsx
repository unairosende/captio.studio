import { notFound } from 'next/navigation'

import ReviewClient from '@/components/review/ReviewClient'
import { getSession, requireOrgContext } from '@/lib/auth/session'
import { listComments } from '@/lib/db/comments'
import { getProject } from '@/lib/db/projects'
import { getSequence, listVersions } from '@/lib/db/sequences'
import { sequencePlayback } from '@/lib/storage/playback'
import { readCues } from '@/lib/subtitles/data'

/**
 * The review view, for the team.
 *
 * The same component the client gets through a link, opened with a session
 * instead. Here it is where the team reads what the client said and answers,
 * compares languages without the editor's machinery around them, and can put
 * an earlier version back — which the client cannot.
 *
 * No auth check of its own: app/(app)/layout.tsx already refuses anyone
 * without a session and an organisation.
 */

interface Props {
  params: Promise<{ sequenceId: string }>
  searchParams: Promise<{ cue?: string }>
}

export default async function TeamReviewPage({ params, searchParams }: Props) {
  const [{ orgId, userId }, session, { sequenceId }, { cue }] = await Promise.all([
    requireOrgContext(),
    getSession(),
    params,
    searchParams,
  ])

  const sequence = await getSequence(orgId, sequenceId)
  if (!sequence) notFound()

  const [project, comments, versions, playback] = await Promise.all([
    getProject(orgId, sequence.project_id),
    listComments(orgId, sequenceId),
    listVersions(orgId, sequenceId),
    sequencePlayback(orgId, sequenceId),
  ])
  if (!project) notFound()

  const focus = Number(cue)

  return (
    <ReviewClient
      key={sequence.version}
      self={{ userId, name: session?.user.name || session?.user.email || 'You' }}
      canEdit
      canRestore
      back={`/projects/${project.id}`}
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
      playback={playback}
      focusCue={Number.isInteger(focus) && focus > 0 ? focus : undefined}
    />
  )
}
