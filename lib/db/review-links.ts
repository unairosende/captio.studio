import { randomBytes } from 'node:crypto'

import { REVIEW_LINK_EXPIRY_SECONDS } from '../auth/expiry.ts'
import { query, queryOne, requireOrg } from './client.ts'
import { UnknownProjectError } from './sequences.ts'

/**
 * Review links and the guests who arrive through them.
 *
 * A link is a credential for one project, held by a client who has no account.
 * Everything in this file is scoped by organisation like the rest of lib/db,
 * with one exception that is the whole point: `getLinkByToken` starts from the
 * token and *produces* the org_id — the same way `listOrganizationIds` starts
 * from nothing — and every query after it is scoped by what it returned.
 */

export interface ReviewLinkRow {
  id: string
  org_id: string
  project_id: string
  token: string
  label: string | null
  can_edit: boolean
  created_by: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export interface ReviewGuestRow {
  id: string
  org_id: string
  link_id: string
  name: string
  email: string
  created_at: string
  last_seen_at: string
}

/** A link as the project page lists it: with the people who have used it. */
export type ReviewLinkSummary = ReviewLinkRow & {
  guests: Pick<ReviewGuestRow, 'name' | 'email' | 'last_seen_at'>[]
}

/** URL-safe and unguessable; 192 bits is more than any session cookie carries. */
const newToken = () => randomBytes(24).toString('base64url')

/**
 * Ids that arrive from a cookie or a URL are checked for shape before they reach
 * a `uuid` column. Postgres answers a malformed one with an error, not with an
 * empty result, and an error here is a 500 a stranger can produce at will.
 */
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function createLink(
  orgId: string,
  input: { projectId: string; label?: string | null; canEdit?: boolean; createdBy?: string | null },
): Promise<ReviewLinkRow> {
  const rows = await query<ReviewLinkRow>(
    `insert into review_links (org_id, project_id, token, label, can_edit, created_by, expires_at)
     select $1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7)
      where exists (select 1 from projects where id = $2 and org_id = $1)
     returning *`,
    [
      requireOrg(orgId),
      input.projectId,
      newToken(),
      input.label?.trim() || null,
      input.canEdit ?? true,
      input.createdBy ?? null,
      REVIEW_LINK_EXPIRY_SECONDS,
    ],
  )
  // The tenancy check is the `where exists` inside the INSERT, as in
  // createSequence: the foreign key would accept another organisation's project.
  if (!rows[0]) throw new UnknownProjectError()
  return rows[0]
}

export async function listLinks(orgId: string, projectId: string): Promise<ReviewLinkSummary[]> {
  return query<ReviewLinkSummary>(
    `select l.*,
            coalesce(
              jsonb_agg(
                jsonb_build_object('name', g.name, 'email', g.email, 'last_seen_at', g.last_seen_at)
                order by g.last_seen_at desc
              ) filter (where g.id is not null),
              '[]'::jsonb
            ) as guests
       from review_links l
       left join review_guests g on g.link_id = l.id and g.org_id = l.org_id
      where l.org_id = $1 and l.project_id = $2
      group by l.id
      order by l.created_at desc`,
    [requireOrg(orgId), projectId],
  )
}

/** Revoke rather than delete: the comments made through it keep their provenance. */
export async function revokeLink(orgId: string, projectId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update review_links set revoked_at = now()
      where org_id = $1 and project_id = $2 and id = $3 and revoked_at is null
      returning id`,
    [requireOrg(orgId), projectId, id],
  )
  return rows.length > 0
}

/**
 * The link a token names, if it is still good.
 *
 * Deliberately unscoped: the token is the only thing the caller has, and the
 * organisation is what this lookup is for. Revoked and expired links resolve to
 * nothing, so callers never need to re-check either.
 */
export async function getLinkByToken(token: string): Promise<ReviewLinkRow | null> {
  if (!token || typeof token !== 'string' || token.length > 64) return null
  return queryOne<ReviewLinkRow>(
    `select * from review_links where token = $1 and revoked_at is null and expires_at > now()`,
    [token],
  )
}

/** Whether a sequence sits inside the project a link opens. */
export async function sequenceInProject(
  orgId: string,
  sequenceId: string,
  projectId: string,
): Promise<boolean> {
  if (!isUuid(sequenceId)) return false
  const rows = await query<{ id: string }>(
    `select id from sequences where org_id = $1 and id = $2 and project_id = $3`,
    [requireOrg(orgId), sequenceId, projectId],
  )
  return rows.length > 0
}

/**
 * Who is holding the link. The same address through the same link is the same
 * guest, with whatever name they gave this time.
 */
export async function registerGuest(
  orgId: string,
  linkId: string,
  input: { name: string; email: string },
): Promise<ReviewGuestRow> {
  const rows = await query<ReviewGuestRow>(
    `insert into review_guests (org_id, link_id, name, email)
     values ($1, $2, $3, $4)
     on conflict (link_id, email) do update
        set name = excluded.name, last_seen_at = now()
     returning *`,
    [requireOrg(orgId), linkId, input.name.trim(), input.email.trim().toLowerCase()],
  )
  return rows[0]
}

export async function getGuest(
  orgId: string,
  linkId: string,
  id: string,
): Promise<ReviewGuestRow | null> {
  if (!isUuid(id)) return null
  return queryOne<ReviewGuestRow>(
    `select * from review_guests where org_id = $1 and link_id = $2 and id = $3`,
    [requireOrg(orgId), linkId, id],
  )
}

export async function touchGuest(orgId: string, id: string): Promise<void> {
  await query(`update review_guests set last_seen_at = now() where org_id = $1 and id = $2`, [
    requireOrg(orgId),
    id,
  ])
}
