import { isUuid, query, queryOne, requireOrg, transaction } from './client.ts'
import { applyAnchorOps, type AnchorOp } from './comments.ts'

/**
 * One subtitle track: cues, their translations, and the timings they share.
 *
 * This is what the schema called a `project` until migration 0007. It is now a
 * sequence, and a project is the thing that holds several of them — a feature
 * and its reels, a series and its episodes. See lib/db/projects.ts.
 */

export interface SequenceRow {
  id: string
  org_id: string
  /** The project it belongs to. Never null: a sequence always lives somewhere. */
  project_id: string
  name: string
  source_lang: string | null
  target_langs: string[]
  fps: string
  data: unknown
  /** Bumped by trigger on every update; the token for optimistic locking. */
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/** List view never ships `data` — a feature-length sequence is megabytes of JSON. */
export type SequenceSummary = Omit<SequenceRow, 'data'> & {
  /** How many cues it holds, counted in the database rather than shipped. */
  cue_count: number
}

/**
 * The size of a sequence, without any of it.
 *
 * Names and dates alone give nobody a way to tell a finished reel from an empty
 * draft opened once by mistake, and the whole point of the columns above is that
 * `data` never leaves Postgres.
 *
 * The type check is not defensive noise. `data` is free-form jsonb — `{}` for a
 * sequence created straight through the API — and `jsonb_array_length` raises on
 * anything that is not an array rather than returning null, so without the guard
 * one such row takes the entire list down with it.
 */
const CUE_COUNT = `case
     when jsonb_typeof(data -> 'subtitles') = 'array' then jsonb_array_length(data -> 'subtitles')
     else 0
   end as cue_count`

const SUMMARY_COLS =
  `id, org_id, project_id, name, source_lang, target_langs, fps, version, created_by,
   created_at, updated_at,
   ${CUE_COUNT}`

/**
 * The sequences in one project.
 *
 * Scoped by organisation as well as by project, though the project is already
 * org-scoped. The redundancy is the bargain 0001 struck for every table: "is
 * this query scoped?" stays a one-column check that a grep or a test can answer,
 * rather than a chain of joins nobody re-reads.
 */
export async function listSequences(orgId: string, projectId: string): Promise<SequenceSummary[]> {
  return query<SequenceSummary>(
    `select ${SUMMARY_COLS} from sequences
      where org_id = $1 and project_id = $2
      order by updated_at desc`,
    [requireOrg(orgId), projectId],
  )
}

/** Everything an organisation has, newest first — for recent work and search. */
export async function listAllSequences(orgId: string, limit = 200): Promise<SequenceSummary[]> {
  return query<SequenceSummary>(
    `select ${SUMMARY_COLS} from sequences
      where org_id = $1
      order by updated_at desc
      limit $2`,
    [requireOrg(orgId), limit],
  )
}

export async function getSequence(orgId: string, id: string): Promise<SequenceRow | null> {
  return queryOne<SequenceRow>(`select * from sequences where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    id,
  ])
}

export class UnknownProjectError extends Error {
  readonly status = 404
  constructor() {
    super('Project not found')
    this.name = 'UnknownProjectError'
  }
}

export class ConflictError extends Error {
  constructor() {
    super('Sequence was modified by someone else')
    this.name = 'ConflictError'
  }
}

export async function createSequence(
  orgId: string,
  input: {
    projectId: string
    name: string
    sourceLang?: string | null
    targetLangs?: string[]
    fps?: number
    data?: unknown
    createdBy?: string | null
  },
): Promise<SequenceRow> {
  const rows = await query<SequenceRow>(
    `insert into sequences (org_id, project_id, name, source_lang, target_langs, fps, data, created_by)
     select $1, $2, $3, $4, $5, $6, $7, $8
      where exists (select 1 from projects where id = $2 and org_id = $1)
     returning *`,
    [
      requireOrg(orgId),
      input.projectId,
      input.name,
      input.sourceLang ?? null,
      input.targetLangs ?? [],
      input.fps ?? 25,
      JSON.stringify(input.data ?? {}),
      input.createdBy ?? null,
    ],
  )

  // The `where exists` is the tenancy check, and it lives inside the INSERT
  // rather than in a SELECT before it. The foreign key alone would happily
  // accept another organisation's project id, and checking beforehand leaves a
  // gap between the check and the write.
  if (!rows[0]) throw new UnknownProjectError()
  return rows[0]
}

/**
 * Update a sequence, optionally only if nobody else has touched it since.
 *
 * `expectedVersion` makes the check part of the UPDATE rather than a read
 * followed by a write: two editors saving in the same instant can both pass a
 * prior SELECT, but only one can pass this.
 *
 * The token is the integer `version`, not `updated_at`. Timestamps look like
 * they would work and do not: Postgres keeps microseconds, a JavaScript Date
 * keeps milliseconds, so a timestamp sent back by the client never equals the
 * stored one and every save would report a conflict that never happened.
 *
 * Returns `null` when the sequence does not exist **or** belongs to another
 * organisation — callers must not distinguish the two, or the API becomes an
 * oracle for which ids exist.
 */
export async function updateSequence(
  orgId: string,
  id: string,
  patch: {
    name?: string
    sourceLang?: string | null
    targetLangs?: string[]
    fps?: number
    data?: unknown
    /** Moving it to another project, which must belong to the same organisation. */
    projectId?: string
  },
  opts: {
    expectedVersion?: number
    /**
     * The cue splits and deletions this save contains, in the order they were made.
     *
     * They arrive with the save rather than as they happen because the cues
     * themselves are only written here: moving the anchors earlier would leave
     * them describing a renumbering that the editor might still abandon.
     */
    anchorOps?: AnchorOp[]
    /** Who is saving — a user, or a client through a review link. Signs the version. */
    createdBy?: string | null
    guestId?: string | null
    /** What this save was, in the saver's words: "round 2 corrections". */
    note?: string | null
  } = {},
): Promise<SequenceRow | null> {
  const write = async (run: typeof query): Promise<SequenceRow | null> => {
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

    if (patch.projectId !== undefined) {
      // Resolved through a scoped SELECT for the same reason as in
      // createSequence: the foreign key proves the project exists, not that it
      // belongs to the caller. An id from another organisation resolves to null,
      // which the NOT NULL column then refuses outright.
      params.push(patch.projectId)
      sets.push(
        `project_id = (select id from projects where id = $${params.length} and org_id = $1)`,
      )
    }

    if (!sets.length) {
      const existing = await run<SequenceRow>(
        `select * from sequences where org_id = $1 and id = $2`,
        [requireOrg(orgId), id],
      )
      return existing[0] ?? null
    }

    let guard = ''
    if (opts.expectedVersion !== undefined) {
      params.push(opts.expectedVersion)
      guard = ` and version = $${params.length}`
    }

    const rows = await run<SequenceRow>(
      `update sequences set ${sets.join(', ')}
       where org_id = $1 and id = $2${guard}
       returning *`,
      params,
    )

    if (rows.length) return rows[0]

    // No row updated: either it is gone, or someone else saved first.
    const still = await run<{ id: string }>(
      `select id from sequences where org_id = $1 and id = $2`,
      [requireOrg(orgId), id],
    )
    if (opts.expectedVersion !== undefined && still.length) throw new ConflictError()
    return null
  }

  if (!opts.anchorOps?.length && patch.data === undefined) return write(query)

  // Cues and comment anchors are two tables describing the same renumbering.
  // Committing one without the other is the failure this transaction exists for:
  // it leaves every note below the edit quoting a line nobody wrote.
  //
  // The version is recorded in the same transaction for the same reason: a
  // history that can miss the save it describes is not a history.
  return transaction(async run => {
    const sequence = await write(run)
    if (sequence && opts.anchorOps?.length) await applyAnchorOps(orgId, id, opts.anchorOps, run)
    if (sequence && patch.data !== undefined) {
      await recordVersion(run, orgId, id, { userId: opts.createdBy, guestId: opts.guestId }, opts.note)
    }
    return sequence
  })
}

export async function deleteSequence(orgId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from sequences where org_id = $1 and id = $2 returning id`,
    [requireOrg(orgId), id],
  )
  return rows.length > 0
}

export async function duplicateSequence(
  orgId: string,
  id: string,
  name: string,
  createdBy?: string | null,
): Promise<SequenceRow | null> {
  const rows = await query<SequenceRow>(
    `insert into sequences (org_id, project_id, name, source_lang, target_langs, fps, data, created_by)
     select org_id, project_id, $3, source_lang, target_langs, fps, data, $4
       from sequences where org_id = $1 and id = $2
     returning *`,
    [requireOrg(orgId), id, name, createdBy ?? null],
  )
  return rows[0] ?? null
}

// ── History ────────────────────────────────────────────────────────────────

export interface VersionRow {
  id: string
  org_id: string
  sequence_id: string
  data: unknown
  /** The sequence's own counter at the moment of the save — what people call it by. */
  version: number | null
  note: string | null
  /** Who saved: a user, or a client through a review link. */
  created_by: string | null
  guest_id: string | null
  created_at: string
}

/** A version as the history lists it: who, when, what — never the data. */
export type VersionSummary = Omit<VersionRow, 'data'> & { author_name: string | null }

/**
 * Saves by the same person within this many minutes are one version.
 *
 * A client correcting thirty lines saves thirty times, and a history with
 * thirty entries for one sitting is a log, not a history. The first save of a
 * burst opens the version and the rest overwrite it; somebody else saving, or
 * the same person after a pause, starts the next one.
 */
export const VERSION_BURST_MINUTES = 10

type Run = typeof query
type Saver = { userId?: string | null; guestId?: string | null }

/**
 * Record the sequence as it stands, inside the caller's transaction.
 *
 * Taken from the stored row rather than from anything the caller passes in, so
 * it can never record a state that never existed.
 */
async function recordVersion(
  run: Run,
  orgId: string,
  sequenceId: string,
  by: Saver,
  note?: string | null,
): Promise<VersionRow | null> {
  const userId = by.userId ?? null
  const guestId = by.guestId ?? null

  const recent = await run<Pick<VersionRow, 'id' | 'created_by' | 'guest_id'>>(
    `select id, created_by, guest_id from sequence_versions
      where org_id = $1 and sequence_id = $2
        and created_at > now() - make_interval(mins => $3)
      order by created_at desc
      limit 1`,
    [requireOrg(orgId), sequenceId, VERSION_BURST_MINUTES],
  )

  // An anonymous save (no user, no guest) never continues a burst: with nobody
  // to compare, "the same person" cannot be asserted.
  const latest = recent[0]
  const sameSaver =
    latest !== undefined &&
    (userId !== null
      ? latest.created_by === userId && latest.guest_id === null
      : guestId !== null && latest.guest_id === guestId)

  if (sameSaver) {
    const rows = await run<VersionRow>(
      `update sequence_versions v
          set data = s.data, version = s.version, note = coalesce($4, v.note)
         from sequences s
        where v.org_id = $1 and v.id = $3
          and s.org_id = $1 and s.id = $2
        returning v.*`,
      [requireOrg(orgId), sequenceId, latest.id, note ?? null],
    )
    return rows[0] ?? null
  }

  const rows = await run<VersionRow>(
    `insert into sequence_versions (org_id, sequence_id, data, version, created_by, guest_id, note)
     select org_id, id, data, version, $3, $4, $5 from sequences where org_id = $1 and id = $2
     returning *`,
    [requireOrg(orgId), sequenceId, userId, guestId, note ?? null],
  )
  return rows[0] ?? null
}

/** Snapshot the sequence as it stands, outside any save. */
export async function snapshotSequence(
  orgId: string,
  sequenceId: string,
  createdBy?: string | null,
  note?: string | null,
): Promise<VersionRow | null> {
  return transaction(run => recordVersion(run, orgId, sequenceId, { userId: createdBy }, note))
}

export async function listVersions(
  orgId: string,
  sequenceId: string,
  limit = 50,
): Promise<VersionSummary[]> {
  return query<VersionSummary>(
    `select v.id, v.org_id, v.sequence_id, v.version, v.note, v.created_by, v.guest_id, v.created_at,
            coalesce(u."name", g.name) as author_name
       from sequence_versions v
       left join "user" u on u."id" = v.created_by
       left join review_guests g on g.id = v.guest_id and g.org_id = v.org_id
      where v.org_id = $1 and v.sequence_id = $2
      order by v.created_at desc
      limit $3`,
    [requireOrg(orgId), sequenceId, limit],
  )
}

/**
 * One version, with its data.
 *
 * Scoped by sequence as well as by organisation: a guest holds one project, and
 * the sequence in the URL is what keeps a guessed id from opening a version of
 * another one.
 */
export async function getVersion(
  orgId: string,
  sequenceId: string,
  versionId: string,
): Promise<VersionRow | null> {
  if (!isUuid(versionId)) return null
  return queryOne<VersionRow>(
    `select * from sequence_versions where org_id = $1 and sequence_id = $2 and id = $3`,
    [requireOrg(orgId), sequenceId, versionId],
  )
}
