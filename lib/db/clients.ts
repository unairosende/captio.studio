import type { GlossaryEntry } from '../ai/prompt.ts'
import { query, queryOne, requireOrg } from './client.ts'

/**
 * Who a project is for, and the terms that client always uses.
 *
 * A name and a glossary, nothing else. Every project assigned to a client
 * inherits its glossary — see `mergeGlossaries` in lib/subtitles/glossary.ts —
 * so the founder's name settled in the first job is spelt the same in the tenth.
 */
export interface ClientRow {
  id: string
  org_id: string
  name: string
  glossary: GlossaryEntry[]
  created_by: string | null
  created_at: string
  updated_at: string
}

/** What a picker needs: no glossaries for clients nobody opened. */
export type ClientOption = Pick<ClientRow, 'id' | 'name'>

export async function listClients(orgId: string): Promise<ClientOption[]> {
  return query<ClientOption>(`select id, name from clients where org_id = $1 order by lower(name)`, [
    requireOrg(orgId),
  ])
}

/** `null` when it does not exist **or** belongs to another organisation. */
export async function getClient(orgId: string, id: string): Promise<ClientRow | null> {
  return queryOne<ClientRow>(`select * from clients where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    id,
  ])
}

export async function createClient(
  orgId: string,
  input: { name: string; createdBy?: string | null },
): Promise<ClientRow> {
  const rows = await query<ClientRow>(
    `insert into clients (org_id, name, created_by)
     values ($1, $2, $3)
     returning *`,
    [requireOrg(orgId), input.name, input.createdBy ?? null],
  )
  return rows[0]
}

/**
 * Rename a client, or replace its glossary.
 *
 * No version guard, for the same reason as `updateProject`: a short list edited
 * a field at a time is not worth a conflict dialogue.
 */
export async function updateClient(
  orgId: string,
  id: string,
  patch: { name?: string; glossary?: GlossaryEntry[] },
): Promise<ClientRow | null> {
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

  if (!sets.length) return getClient(orgId, id)

  const rows = await query<ClientRow>(
    `update clients set ${sets.join(', ')}
      where org_id = $1 and id = $2
      returning *`,
    params,
  )
  return rows[0] ?? null
}
