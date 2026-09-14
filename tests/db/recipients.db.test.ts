import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createComment } from '../../lib/db/comments.ts'
import { createProject } from '../../lib/db/projects.ts'
import { guestRecipients, recentlyCommented, userRecipients } from '../../lib/db/recipients.ts'
import { createLink, registerGuest, revokeLink } from '../../lib/db/review-links.ts'
import { createSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Who gets the email when somebody comments, against a real Postgres.
 *
 * Nobody subscribes. The conversation is the list: the sequence's creator, the
 * people who have commented, the clients who have — minus whoever is speaking.
 * And a client's first note on a sequence nobody on the team has touched must
 * still reach somebody, or it is a note nobody reads.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const suffix = randomBytes(6).toString('hex')
const org = `test_org_${suffix}`

// Better Auth's user and member rows, so the joins have somebody to find.
// Not cascaded by the organisation, so they are removed by hand afterwards.
const users = {
  creator: { id: `test_user_c_${suffix}`, email: `creator-${suffix}@example.test` },
  colleague: { id: `test_user_k_${suffix}`, email: `colleague-${suffix}@example.test` },
  admin: { id: `test_user_a_${suffix}`, email: `admin-${suffix}@example.test` },
}

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [org, 'Productora', org],
  )
  for (const u of Object.values(users)) {
    await query(
      'insert into "user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, true)',
      [u.id, u.id, u.email],
    )
  }
  await query(
    'insert into "member" ("id", "organizationId", "userId", "role", "createdAt") values ($1, $2, $3, $4, now())',
    [`test_member_${suffix}`, org, users.admin.id, 'admin'],
  )
})

after(async () => {
  if (!HAS_DB) return
  await query('delete from "organization" where id = $1', [org])
  await query('delete from "user" where id = any($1)', [Object.values(users).map(u => u.id)])
  await db().end()
})

async function sequence(createdBy: string | null) {
  const project = await createProject(org, { name: 'Documental' })
  return createSequence(org, { projectId: project.id, name: 'Bobina', createdBy })
}

describe('comment recipients against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('tells the team in the conversation, minus the author', async () => {
    const s = await sequence(users.creator.id)
    const link = await createLink(org, { projectId: s.project_id })
    const ana = await registerGuest(org, link.id, { name: 'Ana', email: 'ana@example.test' })

    await createComment(org, { sequenceId: s.id, cueIndex: 1, body: 'from a colleague', authorId: users.colleague.id })
    const note = await createComment(org, { sequenceId: s.id, cueIndex: 2, body: 'from the client', guestId: ana.id })

    const team = await userRecipients(org, s.id, note, link.id)
    assert.deepEqual(team.map(u => u.email).sort(), [users.colleague.email, users.creator.email].sort())

    // The creator answers: the client hears, the creator does not hear themselves.
    const reply = await createComment(org, { sequenceId: s.id, cueIndex: 2, body: 'fixed', authorId: users.creator.id })
    assert.deepEqual((await userRecipients(org, s.id, reply, null)).map(u => u.email), [users.colleague.email])
    const clients = await guestRecipients(org, s.id, reply)
    assert.deepEqual(clients.map(g => [g.email, g.token]), [['ana@example.test', link.token]])

    // Ana speaks again: she is not on her own list.
    const again = await createComment(org, { sequenceId: s.id, cueIndex: 3, body: 'thanks', guestId: ana.id })
    assert.deepEqual(await guestRecipients(org, s.id, again), [])
  })

  it('does not write to a client whose link has stopped opening', async () => {
    const s = await sequence(users.creator.id)
    const link = await createLink(org, { projectId: s.project_id })
    const ana = await registerGuest(org, link.id, { name: 'Ana', email: 'ana@example.test' })
    await createComment(org, { sequenceId: s.id, cueIndex: 1, body: 'x', guestId: ana.id })
    await revokeLink(org, s.project_id, link.id)

    const reply = await createComment(org, { sequenceId: s.id, cueIndex: 1, body: 'y', authorId: users.creator.id })
    assert.deepEqual(await guestRecipients(org, s.id, reply), [], 'the email would carry a dead link')
  })

  it('finds somebody when a client opens a conversation nobody on the team has touched', async () => {
    const s = await sequence(null)
    const link = await createLink(org, { projectId: s.project_id, createdBy: users.colleague.id })
    const ana = await registerGuest(org, link.id, { name: 'Ana', email: 'ana@example.test' })
    const note = await createComment(org, { sequenceId: s.id, cueIndex: 1, body: 'hello?', guestId: ana.id })

    assert.deepEqual(
      (await userRecipients(org, s.id, note, link.id)).map(u => u.email),
      [users.colleague.email],
      'whoever made the link',
    )

    const anonymous = await createLink(org, { projectId: s.project_id })
    assert.deepEqual(
      (await userRecipients(org, s.id, note, anonymous.id)).map(u => u.email),
      [users.admin.email],
      'failing that, the admins',
    )
  })

  it('stays quiet while the same author keeps commenting', async () => {
    const s = await sequence(users.creator.id)
    const link = await createLink(org, { projectId: s.project_id })
    const ana = await registerGuest(org, link.id, { name: 'Ana', email: 'ana@example.test' })

    const first = await createComment(org, { sequenceId: s.id, cueIndex: 1, body: 'one', guestId: ana.id })
    assert.equal(await recentlyCommented(org, s.id, first), false, 'the first note goes out')

    const second = await createComment(org, { sequenceId: s.id, cueIndex: 2, body: 'two', guestId: ana.id })
    assert.equal(await recentlyCommented(org, s.id, second), true, 'the second is covered by the first')

    // Somebody else is a different conversation turn, and the window is theirs alone.
    const reply = await createComment(org, { sequenceId: s.id, cueIndex: 2, body: 'ok', authorId: users.creator.id })
    assert.equal(await recentlyCommented(org, s.id, reply), false)

    // Ana's first note ages past the window: her next one goes out again.
    await query(`update comments set created_at = now() - interval '31 minutes' where sequence_id = $1 and guest_id = $2`, [s.id, ana.id])
    const later = await createComment(org, { sequenceId: s.id, cueIndex: 3, body: 'three', guestId: ana.id })
    assert.equal(await recentlyCommented(org, s.id, later), false)
  })
})
