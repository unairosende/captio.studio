import { query } from './client.ts'

/**
 * The organisations themselves.
 *
 * Better Auth owns this table. Everything else in this folder is scoped by the
 * ids it hands out, which is why the read below is the one legitimate unscoped
 * statement here: a sweeper or a billing run has to start from the full list,
 * and there is no customer work in this table to leak — only the tenants' own
 * identifiers.
 *
 * Anything that walks this list must still scope every follow-up query by the
 * id it is currently holding. The list is a loop variable, not a licence.
 */
export async function listOrganizationIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(`select id from "organization" order by id`)
  return rows.map(r => r.id)
}

export interface Membership {
  organizationId: string
  role: string
}

/**
 * The organisation a user falls back to when their session does not name one.
 *
 * A session carries the organisation somebody is currently working in, and that
 * is the right thing to trust while it is set. It is not the source of truth
 * for whether they belong anywhere — membership is, and membership lives here.
 *
 * Oldest first, so the fallback is stable. Picking an arbitrary row would move
 * somebody between organisations from one request to the next.
 */
export async function firstMembershipForUser(userId: string): Promise<Membership | null> {
  const rows = await query<Membership>(
    `select "organizationId", role from member
      where "userId" = $1
      order by "createdAt"
      limit 1`,
    [userId],
  )
  return rows[0] ?? null
}
