import type { GlossaryEntry } from '../ai/prompt.ts'
import { query, queryOne, requireOrg } from './client.ts'

/**
 * A project: the job, not the track.
 *
 * Until migration 0007 this name meant one subtitle track, and a customer's
 * list of "projects" was a flat pile of them with the grouping living in their
 * filenames. A feature arrives in reels, a series in episodes; what those share
 * is a client, a deadline and a vocabulary. The track is now a sequence — see
 * lib/db/sequences.ts — and this is the thing that holds them.
 *
 * Deliberately thin. It owns a name and the terminology and nothing else:
 * source and target languages stay on the sequence, because a project is
 * routinely a film plus its trailer, and the trailer is not always cut for the
 * same markets.
 */

export interface ProjectRow {
  id: string
  org_id: string
  name: string
  /**
   * Terms every sequence in this project must respect.
   *
   * Here rather than on the sequence because it is the reason to group work at
   * all: a character's name has to survive from reel one to reel six, and
   * re-typing it per reel is how it stops surviving.
   */
  glossary: GlossaryEntry[]
  created_by: string | null
  created_at: string
  updated_at: string
}

/** What a list needs in order to draw a project without opening it. */
export type ProjectSummary = ProjectRow & {
  sequence_count: number
  /** Cues across every sequence, counted in the database rather than shipped. */
  cue_count: number
  /** Every target language any of its sequences has, sorted. */
  target_langs: string[]
  /**
   * When anybody last touched anything inside.
   *
   * The project row's own `updated_at` only moves when its name or glossary
   * changes, so ordering a list by that would sink a project somebody worked in
   * all afternoon beneath one that was renamed last week.
   */
  last_activity: string
}

/**
 * Aggregates over the sequences inside, as two separate lateral joins.
 *
 * They cannot be one. The languages need `unnest`, which multiplies a sequence
 * into one row per language — and a `count` or `sum` computed alongside it would
 * then count a three-language sequence three times.
 *
 * The `where p.org_id = $1` is part of the fragment rather than something each
 * caller appends. A fragment that is only safe once its caller remembers to
 * scope it is the exact shape of the bug tests/tenancy/scoping.test.ts exists to
 * refuse — and that test reads this text, so writing it the other way fails the
 * build rather than leaking quietly.
 */
/**
 * Cues in one sequences row, guarded.
 *
 * The same expression as in lib/db/sequences.ts and for the same reason:
 * `jsonb_array_length` raises on anything that is not an array, and `data` is
 * free-form, so one odd row would take the whole listing down.
 *
 * A named constant rather than written inline because the type comparison reads
 * as a string literal in SQL, and tests/tenancy/scoping.test.ts refuses those
 * inside a statement — rightly, since it cannot tell a type name from a value
 * somebody forgot to parameterise.
 */
const CUE_COUNT = `coalesce(sum(case
               when jsonb_typeof(data -> 'subtitles') = 'array'
                 then jsonb_array_length(data -> 'subtitles')
               else 0
             end), 0)::int`

const SUMMARY = `
  select p.id, p.org_id, p.name, p.glossary, p.created_by, p.created_at, p.updated_at,
         coalesce(s.sequence_count, 0)   as sequence_count,
         coalesce(s.cue_count, 0)        as cue_count,
         coalesce(l.target_langs, '{}')  as target_langs,
         greatest(p.updated_at, s.last_activity) as last_activity
    from projects p
    left join lateral (
      select count(*)::int as sequence_count,
             ${CUE_COUNT} as cue_count,
             max(updated_at) as last_activity
        from sequences
       where project_id = p.id
    ) s on true
    left join lateral (
      select array_agg(distinct lang order by lang) as target_langs
        from sequences sq, unnest(sq.target_langs) as lang
       where sq.project_id = p.id
    ) l on true
   where p.org_id = $1`

export async function listProjects(orgId: string): Promise<ProjectSummary[]> {
  // `greatest` ignores nulls, so a project with no sequences in it yet orders by
  // its own timestamp rather than falling off the end of the list.
  return query<ProjectSummary>(
    `${SUMMARY} order by greatest(p.updated_at, s.last_activity) desc`,
    [requireOrg(orgId)],
  )
}

export async function getProject(orgId: string, id: string): Promise<ProjectSummary | null> {
  return queryOne<ProjectSummary>(`${SUMMARY} and p.id = $2`, [requireOrg(orgId), id])
}

export async function createProject(
  orgId: string,
  input: { name: string; glossary?: GlossaryEntry[]; createdBy?: string | null },
): Promise<ProjectRow> {
  const rows = await query<ProjectRow>(
    `insert into projects (org_id, name, glossary, created_by)
     values ($1, $2, $3, $4)
     returning *`,
    [requireOrg(orgId), input.name, JSON.stringify(input.glossary ?? []), input.createdBy ?? null],
  )
  return rows[0]
}

/**
 * Rename a project, or replace its glossary.
 *
 * No version guard, unlike a sequence. What is stored here is a name and a short
 * list of terms, edited a field at a time by people who see each other's changes
 * on the next load; refusing a save because a colleague added a term thirty
 * seconds ago would be a conflict dialogue over nothing.
 *
 * Returns `null` when it does not exist **or** belongs to another organisation.
 * Callers must not distinguish the two.
 */
export async function updateProject(
  orgId: string,
  id: string,
  patch: { name?: string; glossary?: GlossaryEntry[] },
): Promise<ProjectRow | null> {
  const sets: string[] = []
  const params: unknown[] = [requireOrg(orgId), id]

  if (patch.name !== undefined) {
    params.push(patch.name)
    sets.push(`name = $${params.length}`)
  }
  if (patch.glossary !== undefined) {
    params.push(JSON.stringify(patch.glossary))
    sets.push(`glossary = $${params.length}`)
  }

  if (!sets.length) {
    return queryOne<ProjectRow>(`select * from projects where org_id = $1 and id = $2`, [
      requireOrg(orgId),
      id,
    ])
  }

  const rows = await query<ProjectRow>(
    `update projects set ${sets.join(', ')}
      where org_id = $1 and id = $2
      returning *`,
    params,
  )
  return rows[0] ?? null
}

/**
 * Delete a project and everything in it.
 *
 * The sequences go with it, and their comments, versions and media rows go with
 * them — `on delete cascade` all the way down. That is the honest semantic for a
 * container, and it is also why whoever calls this has to say out loud how many
 * sequences are about to disappear.
 *
 * The stored media objects are NOT removed here. Only rows go; the bytes need
 * the sweeper — see lib/db/media.ts.
 */
export async function deleteProject(orgId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from projects where org_id = $1 and id = $2 returning id`,
    [requireOrg(orgId), id],
  )
  return rows.length > 0
}
