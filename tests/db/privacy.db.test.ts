import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query, queryOne } from '../../lib/db/client.ts'
import { createComment, listComments } from '../../lib/db/comments.ts'
import { soleOwnerships } from '../../lib/db/organizations.ts'
import { createProject } from '../../lib/db/projects.ts'
import { createLink, forgetExpiredGuests, registerGuest } from '../../lib/db/review-links.ts'
import { createSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Two promises the privacy policy makes, against a real Postgres.
 *
 * A reviewer's address is forgotten once their link stops working — but not
 * their name, and not their comments, which belong to the customer's review.
 * And an account cannot be deleted out from under an organisation that other
 * people still work in.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const hex = () => randomBytes(6).toString('hex')
const orgs: string[] = []
const users: string[] = []

async function newOrg(): Promise<string> {
  const id = `test_org_${hex()}`
  await query('insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())', [
    id,
    `Productora ${id.slice(-4)}`,
    id,
  ])
  orgs.push(id)
  return id
}

async function newUser(): Promise<string> {
  const id = `test_user_${hex()}`
  await query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Prueba', $2, true, now(), now())`,
    [id, `${id}@example.invalid`],
  )
  users.push(id)
  return id
}

async function join(orgId: string, userId: string, role: string) {
  await query(
    `insert into member ("id", "organizationId", "userId", "role", "createdAt") values ($1, $2, $3, $4, now())`,
    [`test_member_${hex()}`, orgId, userId, role],
  )
}

before(async () => {
  if (HAS_DB) await requireDisposableDatabase()
})

after(async () => {
  if (!HAS_DB) return
  await query('delete from "organization" where id = any($1)', [orgs])
  await query('delete from "user" where id = any($1)', [users])
  await db().end()
})

describe('privacy promises against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('forgets the address of a reviewer whose link no longer works, and nothing else', async () => {
    const org = await newOrg()
    const other = await newOrg()
    const project = await createProject(org, { name: 'Documental' })
    const sequence = await createSequence(org, { projectId: project.id, name: 'Bobina', data: { subtitles: [] } })

    const live = await createLink(org, { projectId: project.id })
    const expired = await createLink(org, { projectId: project.id })
    const revoked = await createLink(org, { projectId: project.id })
    await query(`update review_links set expires_at = now() - interval '1 day' where id = $1`, [expired.id])
    await query(`update review_links set revoked_at = now() where id = $1`, [revoked.id])

    const stays = await registerGuest(org, live.id, { name: 'Ana', email: 'ana@cliente.test' })
    const goes = await registerGuest(org, expired.id, { name: 'Luis', email: 'luis@cliente.test' })
    await registerGuest(org, revoked.id, { name: 'Eva', email: 'eva@cliente.test' })
    await createComment(org, { sequenceId: sequence.id, cueIndex: 1, body: 'Cambia el nombre', guestId: goes.id })

    const theirProject = await createProject(other, { name: 'Ajeno' })
    const theirs = await createLink(other, { projectId: theirProject.id })
    await query(`update review_links set expires_at = now() - interval '1 day' where id = $1`, [theirs.id])
    const untouched = await registerGuest(other, theirs.id, { name: 'Otro', email: 'otro@cliente.test' })

    assert.equal(await forgetExpiredGuests(org), 2)

    const email = async (id: string) =>
      (await queryOne<{ email: string | null }>('select email from review_guests where id = $1', [id]))?.email
    assert.equal(await email(stays.id), 'ana@cliente.test')
    assert.equal(await email(goes.id), null)
    // Each organisation is swept on its own pass; this one has not been.
    assert.equal(await email(untouched.id), 'otro@cliente.test')

    // The comment survives, still signed with the name.
    const [comment] = await listComments(org, sequence.id)
    assert.equal(comment.body, 'Cambia el nombre')
    assert.equal(comment.author_name, 'Luis')

    // Idempotent: a second night finds nothing left to forget.
    assert.equal(await forgetExpiredGuests(org), 0)
  })

  it('names the organisations only this person owns, with how many people are in them', async () => {
    const person = await newUser()
    const partner = await newUser()
    const helper = await newUser()

    const alone = await newOrg()
    await join(alone, person, 'owner')

    const crewed = await newOrg()
    await join(crewed, person, 'owner')
    await join(crewed, helper, 'member')

    const coOwned = await newOrg()
    await join(coOwned, person, 'owner')
    await join(coOwned, partner, 'owner')

    const asMember = await newOrg()
    await join(asMember, partner, 'owner')
    await join(asMember, person, 'member')

    const owned = await soleOwnerships(person)
    assert.deepEqual(
      owned.map(o => [o.id, o.members]).sort(),
      [[alone, 1], [crewed, 2]].sort(),
    )
  })
})
