import { notFound } from 'next/navigation'

import { requireOrgContext } from '@/lib/auth/session'
import { getClient, listClients } from '@/lib/db/clients'
import { getProject } from '@/lib/db/projects'
import { listLinks } from '@/lib/db/review-links'
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

  const [project, sequences, links, clients] = await Promise.all([
    getProject(orgId, id),
    listSequences(orgId, id),
    listLinks(orgId, id),
    listClients(orgId),
  ])

  if (!project) notFound()

  const client = project.client_id ? await getClient(orgId, project.client_id) : null

  return (
    <ProjectClient
      project={project}
      sequences={sequences}
      links={links}
      clients={clients}
      client={client && { id: client.id, name: client.name, glossary: client.glossary }}
    />
  )
}
