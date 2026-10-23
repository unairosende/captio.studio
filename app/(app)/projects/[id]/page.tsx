import { notFound } from 'next/navigation'

import { requireOrgContext } from '@/lib/auth/session'
import { getClient, listClients } from '@/lib/db/clients'
import { getProject } from '@/lib/db/projects'
import { listLinks } from '@/lib/db/review-links'
import { listRelatedTracks, listSequences } from '@/lib/db/sequences'
import { mergeGlossaries, readCues, suggestVariants } from '@/lib/subtitles'

import ProjectClient from './ProjectClient'

/** A page of suggestions, not an audit: the most frequent first, and the rest once these are dealt with. */
const MAX_SUGGESTIONS = 12

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

  const [client, tracks] = await Promise.all([
    project.client_id ? getClient(orgId, project.client_id) : null,
    listRelatedTracks(orgId, id),
  ])

  // The corrections the team keeps making to transcriptions, here and in the
  // client's other projects, measured against every term already in force.
  const suggestions = suggestVariants(
    tracks.flatMap(t => readCues(t.data).subtitles),
    mergeGlossaries(project.glossary, client?.glossary),
    project.dismissed_variants,
  ).slice(0, MAX_SUGGESTIONS)

  return (
    <ProjectClient
      project={project}
      sequences={sequences}
      links={links}
      clients={clients}
      client={client && { id: client.id, name: client.name, glossary: client.glossary }}
      suggestions={suggestions}
    />
  )
}
