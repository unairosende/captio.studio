import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'

import { auth } from '../../lib/auth/server.ts'
import { db, query } from '../../lib/db/client.ts'
import { createProject, getProject, listProjects } from '../../lib/db/projects.ts'

/**
 * The seam between authentication and data access.
 *
 * `isolation.db.test.ts` proves lib/db scopes by whatever org id it is handed.
 * This proves the org id the application hands it is the right one: derived from
 * a real session and a real membership, not from anything a caller can set.
 *
 *   npm run test:db
 *
 * Uses example.invalid addresses, which by RFC can never be delivered to, so a
 * misconfiguration cannot mail a stranger.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const stamp = randomBytes(5).toString('hex')
const emails = [`captio-test-a-${stamp}@example.invalid`, `captio-test-b-${stamp}@example.invalid`]
const PASSWORD = `Pw-${randomBytes(12).toString('hex')}`

after(async () => {
  if (!HAS_DB) return
  // Users cascade to sessions, accounts and memberships; organisations cascade
  // to every product table via the 0004 foreign keys.
  await query('delete from "organization" where slug like $1', [`test-${stamp}%`])
  await query('delete from "user" where email like $1', [`captio-test-%-${stamp}@example.invalid`])
  await db().end()
})

/** Collect the session cookie Better Auth sets, to replay on later calls. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

async function signedInUser(email: string): Promise<{ cookie: string; userId: string }> {
  await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: `Test ${email.slice(0, 12)}` },
    asResponse: true,
  })

  // Sign-up alone leaves the account unverified, and unverified accounts cannot
  // sign in. Flipping the flag directly keeps the test on the real
  // configuration instead of weakening it to make the test pass.
  await query('update "user" set "emailVerified" = true where email = $1', [email])

  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  })
  const cookie = cookieFrom(res)
  assert.ok(cookie, `no session cookie for ${email}`)

  const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
  assert.ok(session?.user, 'session did not resolve to a user')
  return { cookie, userId: session.user.id }
}

async function orgFor(cookie: string, name: string, slug: string): Promise<string> {
  const org = await auth.api.createOrganization({
    body: { name, slug },
    headers: new Headers({ cookie }),
  })
  assert.ok(org?.id, 'organisation was not created')

  await auth.api.setActiveOrganization({
    body: { organizationId: org.id },
    headers: new Headers({ cookie }),
  })
  return org.id
}

describe('auth and organisations', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('gives a signed-in user an organisation the session can resolve', async () => {
    const { cookie, userId } = await signedInUser(emails[0])
    const orgId = await orgFor(cookie, 'Productora A', `test-${stamp}-a`)

    // This is what requireOrgContext() relies on: the active membership comes
    // from the session, so a request cannot nominate its own organisation.
    const member = await auth.api.getActiveMember({ headers: new Headers({ cookie }) })
    assert.equal(member?.organizationId, orgId)
    assert.equal(member?.userId, userId)
    assert.equal(member?.role, 'owner', 'whoever creates the organisation owns it')
  })

  it('keeps one signed-in user out of another organisation’s projects', async () => {
    const b = await signedInUser(emails[1])
    const orgB = await orgFor(b.cookie, 'Productora B', `test-${stamp}-b`)

    const orgA = (
      await query<{ id: string }>('select id from "organization" where slug = $1', [
        `test-${stamp}-a`,
      ])
    )[0].id

    const projectA = await createProject(orgA, { name: 'Rodaje A', createdBy: 'someone' })

    // B is properly signed in and holds a real project id. Still nothing.
    assert.equal(await getProject(orgB, projectA.id), null)
    assert.deepEqual(await listProjects(orgB), [])
    assert.equal((await listProjects(orgA)).length, 1)
  })

  it('refuses a session that is not signed in', async () => {
    const none = await auth.api.getSession({ headers: new Headers() })
    assert.equal(none, null)

    const member = await auth.api.getActiveMember({ headers: new Headers() }).catch(() => null)
    assert.equal(member, null, 'an anonymous request must not resolve a membership')
  })

  it('does not sign in an account whose email is unverified', async () => {
    const email = `captio-test-unverified-${stamp}@example.invalid`
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Sin verificar' },
      asResponse: true,
    })

    const res = await auth.api
      .signInEmail({ body: { email, password: PASSWORD }, asResponse: true })
      .catch(() => null)

    const cookie = res ? cookieFrom(res) : ''
    const session = cookie
      ? await auth.api.getSession({ headers: new Headers({ cookie }) })
      : null
    assert.equal(session, null, 'an unverified account must not receive a session')
  })
})
