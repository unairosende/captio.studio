import { headers } from 'next/headers'

import { firstMembershipForUser } from '../db/organizations.ts'
import { auth } from './server.ts'

/**
 * Who is asking, and on behalf of which organisation.
 *
 * The organisation id is read from the server-side session, never from the
 * request. That rule is what makes every `org_id = $1` in lib/db worth
 * anything: if a route accepted an org id from the client, a caller could pass
 * someone else's and every filter would dutifully scope to the wrong tenant.
 */
export interface OrgContext {
  userId: string
  orgId: string
  /** owner | admin | member — the organisation plugin's role for this user. */
  role: string
}

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}

export class NoOrganizationError extends Error {
  readonly status = 403
  constructor() {
    super('No active organization')
    this.name = 'NoOrganizationError'
  }
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function requireUser(): Promise<{ id: string; email: string }> {
  const session = await getSession()
  if (!session?.user) throw new UnauthorizedError()
  return { id: session.user.id, email: session.user.email }
}

/**
 * The caller's organisation context, or a thrown error.
 *
 * Membership is re-checked through the plugin rather than trusted from the
 * session alone: a session can outlive a removal from the organisation, and a
 * removed collaborator must lose access on their next request, not whenever
 * their session happens to expire.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const h = await headers()

  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) throw new UnauthorizedError()

  const member = await auth.api.getActiveMember({ headers: h }).catch(() => null)
  if (member?.organizationId) {
    return { userId: session.user.id, orgId: member.organizationId, role: member.role }
  }

  // A session with no active organisation is not the same thing as a user with
  // no organisation, and treating them alike deadlocks the app: /translate
  // refuses and sends them to onboarding, onboarding sees they already belong
  // somewhere and sends them back. That loop is what a returning customer hits
  // on their second sign-in, because nothing had set the active organisation on
  // the new session.
  //
  // Membership is still read from the database here, so this is a second route
  // to the same check rather than a weaker one.
  const fallback = await firstMembershipForUser(session.user.id)
  if (!fallback) throw new NoOrganizationError()

  return { userId: session.user.id, orgId: fallback.organizationId, role: fallback.role }
}

/** Roles allowed to change what the organisation is billed for or who belongs to it. */
const ADMIN_ROLES = new Set(['owner', 'admin'])

export function isAdmin(ctx: OrgContext): boolean {
  return ADMIN_ROLES.has(ctx.role)
}

/**
 * Turn an auth failure into a response.
 *
 * Anything that is not an auth error is rethrown: swallowing unknown errors
 * here would turn a genuine bug into a silent 500 with no stack anywhere.
 */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof UnauthorizedError || err instanceof NoOrganizationError) {
    return Response.json({ error: err.message }, { status: err.status })
  }
  throw err
}
