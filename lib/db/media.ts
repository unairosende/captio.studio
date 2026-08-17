import { query, queryOne, requireOrg } from './client.ts'

export interface MediaRow {
  id: string
  org_id: string
  /**
   * The sequence it was uploaded for, once there is one.
   *
   * Nullable on purpose: the bytes go up before anybody has saved the work they
   * belong to, so an upload exists for a while attached to nothing. Closing that
   * gap is what `orphanedStorageKeys` below is for.
   */
  sequence_id: string | null
  storage_key: string
  filename: string | null
  bytes: string | null
  duration_seconds: string | null
  created_by: string | null
  created_at: string
}

export async function createMedia(
  orgId: string,
  input: {
    sequenceId?: string | null
    storageKey: string
    filename?: string | null
    bytes?: number | null
    durationSeconds?: number | null
    createdBy?: string | null
  },
): Promise<MediaRow> {
  const rows = await query<MediaRow>(
    `insert into media (org_id, sequence_id, storage_key, filename, bytes, duration_seconds, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      requireOrg(orgId),
      input.sequenceId ?? null,
      input.storageKey,
      input.filename ?? null,
      input.bytes ?? null,
      input.durationSeconds ?? null,
      input.createdBy ?? null,
    ],
  )
  return rows[0]
}

export async function getMedia(orgId: string, id: string): Promise<MediaRow | null> {
  return queryOne<MediaRow>(`select * from media where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    id,
  ])
}

export async function listSequenceMedia(orgId: string, sequenceId: string): Promise<MediaRow[]> {
  return query<MediaRow>(
    `select * from media where org_id = $1 and sequence_id = $2 order by created_at desc`,
    [requireOrg(orgId), sequenceId],
  )
}

export async function deleteMedia(orgId: string, id: string): Promise<string | null> {
  const rows = await query<{ storage_key: string }>(
    `delete from media where org_id = $1 and id = $2 returning storage_key`,
    [requireOrg(orgId), id],
  )
  // Caller must delete the object too; the row going away does not free the bytes.
  return rows[0]?.storage_key ?? null
}

/**
 * Uploads that never got attached to a sequence.
 *
 * Deleting a sequence cascades its media rows but leaves the objects in the
 * bucket, and an abandoned upload never had a sequence to begin with. Both are a
 * bill nobody is watching and an unmet erasure request, so a sweeper needs to
 * be able to find them.
 */
export async function orphanedStorageKeys(orgId: string, limit = 500): Promise<string[]> {
  const rows = await query<{ storage_key: string }>(
    `select storage_key from media
      where org_id = $1 and sequence_id is null and created_at < now() - interval '24 hours'
      order by created_at
      limit $2`,
    [requireOrg(orgId), limit],
  )
  return rows.map(r => r.storage_key)
}

/**
 * Forget the rows whose objects the sweeper has just deleted.
 *
 * Called only after the bytes are gone, never before. The other order loses the
 * only record of which keys exist, and an object nothing points at is invisible
 * — it just accrues storage until somebody reads the bill closely.
 */
export async function deleteMediaByStorageKeys(orgId: string, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0
  const rows = await query<{ id: string }>(
    `delete from media where org_id = $1 and storage_key = any($2::text[]) returning id`,
    [requireOrg(orgId), keys],
  )
  return rows.length
}
