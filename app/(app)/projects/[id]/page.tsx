import { notFound } from 'next/navigation'

import { requireOrgContext } from '@/lib/auth/session'
import { getProject } from '@/lib/db/projects'
import { listSequences } from '@/lib/db/sequences'

import ProjectClient from './ProjectClient'

/**
 * One project, and the sequences in it.
 *
 * Scoped by organisation, so somebody else's project is a 404 rather than a
 * 403 — the difference would confirm the id exists.
 */

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  const [{ orgId }, { id }] = await Promise.all([requireOrgContext(), params])

  const [project, sequences] = await Promise.all([
    getProject(orgId, id),
    listSequences(orgId, id),
  ])

  if (!project) notFound()

  return <ProjectClient project={project} sequences={sequences} />
}
