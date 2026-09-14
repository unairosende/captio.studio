import type { CommentRow } from './comments.ts'
import { query, requireOrg } from './client.ts'

/**
 * Who should hear that a comment was made.
 *
 * Nobody subscribes to anything. The people who get told are the ones already
 * in the conversation: whoever created the sequence, whoever has commented on
 * it, and — on the client's side — the guests who have. Minus the author, who
 * knows. That rule is symmetric on purpose: a client hears back when the team
 * answers, through the same code that told the team.
 */

export interface UserRecipient {
  id: string
  email: string
  name: string | null
}

export interface GuestRecipient {
  email: string
  name: string
  /** Their link's token, so the email can carry a URL that opens for them. */
  token: string
}

/**
 * How long after somebody's comment their next one on the same sequence is
 * assumed to have been covered by the first email. A client leaving forty notes
 * in an afternoon is one event, not forty.
 */
export const COMMENT_QUIET_MINUTES = 30

/** Whether this author already had a comment on this sequence inside the quiet window. */
export async function recentlyCommented(
  orgId: string,
  sequenceId: string,
  comment: Pick<CommentRow, 'id' | 'author_id' | 'guest_id'>,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `select id from comments
      where org_id = $1 and sequence_id = $2 and id <> $3
        and (author_id = $4 or guest_id = $5)
        and created_at > now() - make_interval(mins => $6)
      limit 1`,
    [requireOrg(orgId), sequenceId, comment.id, comment.author_id, comment.guest_id, COMMENT_QUIET_MINUTES],
  )
  return rows.length > 0
}

/**
 * The team members in the conversation, minus the author.
 *
 * When a client opens the conversation on a sequence nobody on the team has
 * touched — created through the API, never commented — there is still somebody
 * to tell: whoever made the link, and failing that the organisation's admins.
 * An email that goes to nobody is a comment nobody reads.
 */
export async function userRecipients(
  orgId: string,
  sequenceId: string,
  comment: Pick<CommentRow, 'author_id' | 'guest_id'>,
  linkId: string | null,
): Promise<UserRecipient[]> {
  const involved = await query<UserRecipient>(
    `select u."id", u."email", u."name"
       from "user" u
      where u."id" in (
              select created_by from sequences
               where org_id = $1 and id = $2 and created_by is not null
              union
              select author_id from comments
               where org_id = $1 and sequence_id = $2 and author_id is not null
            )
        and u."id" is distinct from $3
      order by u."email"`,
    [requireOrg(orgId), sequenceId, comment.author_id],
  )
  if (involved.length || comment.guest_id === null) return involved

  if (linkId) {
    const creator = await query<UserRecipient>(
      `select u."id", u."email", u."name"
         from review_links l
         join "user" u on u."id" = l.created_by
        where l.org_id = $1 and l.id = $2`,
      [requireOrg(orgId), linkId],
    )
    if (creator.length) return creator
  }

  return query<UserRecipient>(
    `select u."id", u."email", u."name"
       from member m
       join "user" u on u."id" = m."userId"
      where m."organizationId" = $1 and m.role in ('owner', 'admin')
      order by u."email"`,
    [requireOrg(orgId)],
  )
}

/**
 * The clients in the conversation, minus the author — one per address, and only
 * while their link still opens, since the email carries a URL into it.
 */
export async function guestRecipients(
  orgId: string,
  sequenceId: string,
  comment: Pick<CommentRow, 'guest_id'>,
): Promise<GuestRecipient[]> {
  return query<GuestRecipient>(
    `select distinct on (g.email) g.email, g.name, l.token
       from review_guests g
       join review_links l on l.id = g.link_id and l.org_id = g.org_id
      where g.org_id = $1
        and g.id in (
              select guest_id from comments
               where org_id = $1 and sequence_id = $2 and guest_id is not null
            )
        and g.id is distinct from $3
        and l.revoked_at is null and l.expires_at > now()
      order by g.email, g.last_seen_at desc`,
    [requireOrg(orgId), sequenceId, comment.guest_id],
  )
}
