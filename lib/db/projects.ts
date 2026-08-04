import { query, queryOne, requireOrg, transaction } from './client.ts'

export interface ProjectRow {
  id: string
  org_id: string
  name: string
  source_lang: string | null
  target_langs: string[]
  fps: string
  data: unknown
  created_by: string | null
  created_at: string
  updated_at: string
}

/** List view never ships `data` — a feature-length project is megabytes of JSON. */
export type ProjectSummary = Omit<ProjectRow, 'data'>

const SUMMARY_COLS =
  'id, org_id, name, source_lang, target_langs, fps, created_by, created_at, updated_at'

export async function listProjects(orgId: string): Promise<ProjectSummary[]> {
  return query<ProjectSummary>(
    `select ${SUMMARY_COLS} from projects where org_id = $1 order by updated_at desc`,
    [requireOrg(orgId)],
  )
}

export async function getProject(orgId: string, id: string): Promise<ProjectRow | null> {
  return queryOne<ProjectRow>(`select * from projects where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    id,
  ])
}

export async function createProject(
  orgId: string,
  input: {
    name: string
    sourceLang?: string | null
    targetLangs?: string[]
    fps?: number
    data?: unknown
    createdBy?: string | null
  },
): Promise<ProjectRow> {
  const rows = await query<ProjectRow>(
    `insert into projects (org_id, name, source_lang, target_langs, fps, data, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      requireOrg(orgId),
      input.name,
      input.sourceLang ?? null,
      input.targetLangs ?? [],
      input.fps ?? 25,
      JSON.stringify(input.data ?? {}),
      input.createdBy ?? null,
    ],
  )
  return rows[0]
}

export class ConflictError extends Error {
  constructor() {
    super('Project was modified by someone else')
    this.name = 'ConflictError'
  }
}

/**
 * Update a project, optionally only if nobody else has touched it since.
 *
 * `expectedUpdatedAt` makes the check part of the UPDATE rather than a read
 * followed by a write: two editors saving in the same instant can both pass a
 * prior SELECT, but only one can pass this.
 *
 * Returns `null` when the project does not exist **or** belongs to another
 * organisation — callers must not distinguish the two, or the API becomes an
 * oracle for which project ids exist.
 */
export async function updateProject(
  orgId: string,
  id: string,
  patch: {
    name?: string
    sourceLang?: string | null
    targetLangs?: string[]
    fps?: number
    data?: unknown
  },
  opts: { expectedUpdatedAt?: string } = {},
): Promise<ProjectRow | null> {
  const sets: string[] = []
  const params: unknown[] = [requireOrg(orgId), id]

  const push = (col: string, val: unknown) => {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }

  if (patch.name !== undefined) push('name', patch.name)
  if (patch.sourceLang !== undefined) push('source_lang', patch.sourceLang)
  if (patch.targetLangs !== undefined) push('target_langs', patch.targetLangs)
  if (patch.fps !== undefined) push('fps', patch.fps)
  if (patch.data !== undefined) push('data', JSON.stringify(patch.data))

  if (!sets.length) return getProject(orgId, id)

  let guard = ''
  if (opts.expectedUpdatedAt) {
    params.push(opts.expectedUpdatedAt)
    guard = ` and updated_at = $${params.length}`
  }

  const rows = await query<ProjectRow>(
    `update projects set ${sets.join(', ')}
     where org_id = $1 and id = $2${guard}
     returning *`,
    params,
  )

  if (rows.length) return rows[0]

  // No row updated: either it is gone, or someone else saved first.
  if (opts.expectedUpdatedAt && (await getProject(orgId, id))) throw new ConflictError()
  return null
}

export async function deleteProject(orgId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from projects where org_id = $1 and id = $2 returning id`,
    [requireOrg(orgId), id],
  )
  return rows.length > 0
}

export async function duplicateProject(
  orgId: string,
  id: string,
  name: string,
  createdBy?: string | null,
): Promise<ProjectRow | null> {
  const rows = await query<ProjectRow>(
    `insert into projects (org_id, name, source_lang, target_langs, fps, data, created_by)
     select org_id, $3, source_lang, target_langs, fps, data, $4
       from projects where org_id = $1 and id = $2
     returning *`,
    [requireOrg(orgId), id, name, createdBy ?? null],
  )
  return rows[0] ?? null
}

// ── History ────────────────────────────────────────────────────────────────

export interface VersionRow {
  id: string
  org_id: string
  project_id: string
  data: unknown
  created_by: string | null
  created_at: string
}

/**
 * Snapshot the project as it stands.
 *
 * The snapshot is taken from the stored row rather than from anything the
 * caller passes in, so it can never record a state that never existed.
 */
export async function snapshotProject(
  orgId: string,
  projectId: string,
  createdBy?: string | null,
): Promise<VersionRow | null> {
  return transaction(async run => {
    const rows = await run<VersionRow>(
      `insert into project_versions (org_id, project_id, data, created_by)
       select org_id, id, data, $3 from projects where org_id = $1 and id = $2
       returning *`,
      [requireOrg(orgId), projectId, createdBy ?? null],
    )
    return rows[0] ?? null
  })
}

export async function listVersions(
  orgId: string,
  projectId: string,
  limit = 50,
): Promise<Omit<VersionRow, 'data'>[]> {
  return query<Omit<VersionRow, 'data'>>(
    `select id, org_id, project_id, created_by, created_at
       from project_versions
      where org_id = $1 and project_id = $2
      order by created_at desc
      limit $3`,
    [requireOrg(orgId), projectId, limit],
  )
}

export async function getVersion(orgId: string, versionId: string): Promise<VersionRow | null> {
  return queryOne<VersionRow>(`select * from project_versions where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    versionId,
  ])
}
