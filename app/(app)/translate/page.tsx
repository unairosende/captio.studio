import { redirect } from 'next/navigation'

import { requireOrgContext, requireUser } from '@/lib/auth/session'
import { listComments } from '@/lib/db/comments'
import { getProject } from '@/lib/db/projects'
import { getSequence } from '@/lib/db/sequences'
import { getEntitlement } from '@/lib/entitlement'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

import TranslateClient from './TranslateClient'

/**
 * The editor.
 *
 * No auth check of its own: app/(app)/layout.tsx already refuses anyone without
 * a session and an organisation. Repeating it here is how the two drift apart
 * and one of them ends up wrong — which is exactly what the old Supabase check
 * did once the layout landed: it sent people holding a valid session back to
 * the login page.
 *
 * It does insist on a project. A sequence has to be created somewhere, and an
 * editor that cannot say where it would save is a form with no destination;
 * anybody arriving without one goes to the dashboard to pick.
 */

interface Props {
  searchParams: Promise<{ project?: string; sequence?: string }>
}

/** `data` is free-form jsonb, so what comes back is checked rather than trusted. */
function readCues(data: unknown): { subtitles: Subtitle[]; translations: TranslationStore } {
  const blob = (data ?? {}) as { subtitles?: unknown; translations?: unknown }
  return {
    subtitles: Array.isArray(blob.subtitles) ? (blob.subtitles as Subtitle[]) : [],
    translations:
      blob.translations && typeof blob.translations === 'object'
        ? (blob.translations as TranslationStore)
        : {},
  }
}

export default async function TranslatePage({ searchParams }: Props) {
  const [{ orgId, userId, role }, user, params] = await Promise.all([
    requireOrgContext(),
    requireUser(),
    searchParams,
  ])

  // A sequence names its own project, so the parameter is only needed when
  // starting a new one — and the sequence's own id wins, because a mismatched
  // pair in a hand-edited URL should not decide where the next save lands.
  const sequence = params.sequence ? await getSequence(orgId, params.sequence) : null
  const projectId = sequence?.project_id ?? params.project

  if (!projectId) redirect('/dashboard')

  // Read here rather than from the browser: this page is already a server
  // component doing a round trip, so the editor can render knowing what is left
  // instead of finding out from the first request that gets refused.
  //
  // Not the gate itself. The gate lives in the API routes, because a limit
  // enforced by the page that draws the button is not a limit.
  const [project, entitlement, comments] = await Promise.all([
    getProject(orgId, projectId),
    getEntitlement(orgId),
    sequence ? listComments(orgId, sequence.id) : Promise.resolve([]),
  ])

  // Scoped by organisation, so an id belonging to somebody else is simply not
  // found — and lands in the same place as one that never existed.
  if (!project) redirect('/dashboard')

  return (
    <TranslateClient
      user={{ id: userId, email: user.email, role }}
      entitlement={entitlement}
      project={{ id: project.id, name: project.name, glossary: project.glossary }}
      sequence={
        sequence && {
          id: sequence.id,
          name: sequence.name,
          version: sequence.version,
          ...readCues(sequence.data),
          comments,
        }
      }
    />
  )
}
