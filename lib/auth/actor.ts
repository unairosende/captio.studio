import type { NextRequest } from 'next/server'

import {
  getGuest,
  getLinkByToken,
  sequenceInProject,
  type ReviewGuestRow,
  type ReviewLinkRow,
} from '../db/review-links.ts'
import { sequenceExists } from '../db/sequences.ts'
import { NotFoundError, UnauthorizedError, requireOrgContext } from './session.ts'

/**
 * Who is asking, when the answer may be "a client holding a link".
 *
 * Two kinds of caller reach the routes that carry a review: a signed-in member
 * of the organisation, and a guest who has no account and holds a review token
 * instead. Both come out of here as an `Actor` with an `orgId` that was
 * resolved on the server — from the session in one case, from the link row in
 * the other. Neither is ever read from the request body.
 *
 * Only the routes that call `requireActor` can be reached by a guest at all,
 * and tests/tenancy/guest-surface.test.ts pins that list. Everything else in
 * app/api still asks for a session and does not know links exist.
 */

export type Actor =
  | { kind: 'user'; orgId: string; userId: string; role: string }
  | {
      kind: 'guest'
      orgId: string
      projectId: string
      linkId: string
      guestId: string
      name: string
      email: string
      canEdit: boolean
    }

/** The header the review view sends with every request made through a link. */
export const REVIEW_TOKEN_HEADER = 'x-review-token'

/**
 * One cookie per link, so a reviewer holding two of the same productora's links
 * is two guests, each known to the project they were let into.
 */
export const guestCookie = (linkId: string) => `review_guest_${linkId}`

/** What the pages under /r/[token] need: the link, and the guest if they have said who they are. */
export async function resolveLink(token: string): Promise<ReviewLinkRow | null> {
  return getLinkByToken(token)
}

export async function resolveGuest(
  link: ReviewLinkRow,
  cookieValue: string | undefined,
): Promise<ReviewGuestRow | null> {
  return cookieValue ? getGuest(link.org_id, link.id, cookieValue) : null
}

/**
 * The caller, checked against the sequence in the URL.
 *
 * A token in the header decides the path, even when a session is also present:
 * the review view sends it, the editor does not, and a member checking a
 * client's link should see exactly what the client sees. A guest is refused
 * with 401 rather than 403 when they have not yet said who they are, because
 * that is the answer the page acts on — show the form.
 *
 * The sequence is verified here for both kinds of caller. For a member that is
 * the ordinary org scope; for a guest it is the project the link opens, which
 * is the whole of what a link grants.
 */
export async function requireActor(req: NextRequest, sequenceId: string): Promise<Actor> {
  const token = req.headers.get(REVIEW_TOKEN_HEADER)

  if (!token) {
    const ctx = await requireOrgContext()
    if (!(await sequenceExists(ctx.orgId, sequenceId))) throw new NotFoundError('Sequence not found')
    return { kind: 'user', orgId: ctx.orgId, userId: ctx.userId, role: ctx.role }
  }

  const link = await getLinkByToken(token)
  if (!link) throw new UnauthorizedError('This link is no longer active')

  if (!(await sequenceInProject(link.org_id, sequenceId, link.project_id))) {
    throw new NotFoundError('Sequence not found')
  }

  const guest = await resolveGuest(link, req.cookies.get(guestCookie(link.id))?.value)
  if (!guest) throw new UnauthorizedError('Say who you are first')

  return {
    kind: 'guest',
    orgId: link.org_id,
    projectId: link.project_id,
    linkId: link.id,
    guestId: guest.id,
    name: guest.name,
    email: guest.email,
    canEdit: link.can_edit,
  }
}
