import { query, queryOne, requireOrg } from './client.ts'

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

export interface OrganizationRow {
  id: string
  name: string
  slug: string
  created_at: string
}

/**
 * One organisation, by id.
 *
 * The dashboard needs its name: an interface that says "your projects" without
 * ever naming whose is fine for one customer and wrong for the freelancer who
 * belongs to three production companies and needs to know which one they are
 * looking at before deleting anything.
 */
export async function getOrganization(orgId: string): Promise<OrganizationRow | null> {
  return queryOne<OrganizationRow>(
    `select id, name, slug, "createdAt" as created_at from "organization" where id = $1`,
    [requireOrg(orgId)],
  )
}

/**
 * Delete an organisation, and with it everything the tenancy owns.
 *
 * Every tenant table's `org_id` is `on delete cascade` against this row (0004,
 * 0007, 0011), and Better Auth's own member and invitation rows cascade too, so
 * a single delete here erases the projects, versions, media rows, comments,
 * usage, review links and guests, subscriptions and memberships in one
 * statement. What it does NOT reach is the bytes in the bucket or the Stripe
 * subscription — both live outside this database — so this is never called on
 * its own: lib/erasure.ts cancels billing and clears the objects first, then
 * this.
 *
 * A raw delete rather than Better Auth's own org endpoint because both callers
 * are server-side and one is a cron with no session to act through, and the
 * cascade is the same either way. `requireOrg` guards the one thing that would
 * be catastrophic — an empty id, which no `where` clause would constrain.
 */
export async function deleteOrganization(orgId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from "organization" where id = $1 returning id`,
    [requireOrg(orgId)],
  )
  return rows.length > 0
}

export interface MemberRow {
  id: string
  user_id: string
  role: string
  name: string | null
  email: string
  joined_at: string
}

/**
 * Who belongs to an organisation.
 *
 * Read here rather than through Better Auth's own endpoint because this is a
 * server render: `listMembers` on the client goes back over HTTP to fetch what
 * this page could have selected while it was already talking to the database.
 * Writes stay with the plugin — see components/team/TeamPanel.tsx — since it
 * owns the rules about who may change a role, and two sets of those rules is
 * one set too many.
 */
export async function listMembers(orgId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `select m.id,
            m."userId"    as user_id,
            m.role,
            m."createdAt" as joined_at,
            u.name,
            u.email
       from member m
       join "user" u on u.id = m."userId"
      where m."organizationId" = $1
      order by m."createdAt"`,
    [requireOrg(orgId)],
  )
}

/**
 * Invitations still waiting to be accepted.
 *
 * Expiry is checked here rather than trusted from `status`. Nothing sweeps the
 * table, so a lapsed invitation keeps saying `pending` for ever — counting those
 * would tell an admin somebody is about to join when the link they were sent
 * stopped working a fortnight ago.
 */
export async function countPendingInvitations(orgId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `select count(*)::int as count
       from invitation
      where "organizationId" = $1 and status = 'pending' and "expiresAt" > now()`,
    [requireOrg(orgId)],
  )
  return row?.count ?? 0
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
