import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import {
  createComment,
  deleteComment,
  listComments,
  setCommentResolved,
} from '../../lib/db/comments.ts'
import { createProject } from '../../lib/db/projects.ts'
import {
  createLink,
  getGuest,
  getLinkByToken,
  listLinks,
  registerGuest,
  revokeLink,
  sequenceInProject,
} from '../../lib/db/review-links.ts'
import {
  UnknownProjectError,
  createSequence,
  listVersions,
  saveTextEdits,
} from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Review links against a real Postgres.
 *
 * A link is a credential for one project. These tests show that it opens
 * exactly that — not another organisation's project, not another project of
 * the same one — that it stops opening anything once revoked or expired, and
 * that what a guest writes through it is signed as theirs.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const orgA = `test_org_${randomBytes(6).toString('hex')}`
const orgB = `test_org_${randomBytes(6).toString('hex')}`

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  for (const org of [orgA, orgB]) {
    await query(
      'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
      [org, `Productora ${org.slice(-4)}`, org],
    )
  }
})

after(async () => {
  if (!HAS_DB) return
  await query('delete from "organization" where id = any($1)', [[orgA, orgB]])
  await db().end()
})

const cue = (index: number, text: string) =>
  ({ index, start: `00:00:0${index},000`, end: `00:00:0${index},500`, text })

async function projectWithSequence(org: string) {
  const project = await createProject(org, { name: 'Documental' })
  const sequence = await createSequence(org, {
    projectId: project.id,
    name: 'Bobina',
    data: { subtitles: [cue(1, 'one')], translations: { Spanish: [cue(1, 'uno')] } },
  })
  return { project, sequence }
}

describe('review links against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('opens exactly the project it was made for', async () => {
    const a = await projectWithSequence(orgA)
    const other = await projectWithSequence(orgA)
    const link = await createLink(orgA, { projectId: a.project.id, label: 'ACME', createdBy: 'user_a' })

    assert.ok(link.token.length >= 32)
    const found = await getLinkByToken(link.token)
    assert.equal(found?.id, link.id)
    assert.equal(found?.org_id, orgA, 'the token is what produces the organisation')

    assert.equal(await sequenceInProject(orgA, a.sequence.id, link.project_id), true)
    assert.equal(
      await sequenceInProject(orgA, other.sequence.id, link.project_id),
      false,
      'another project of the same productora is out of reach',
    )
    assert.equal(await sequenceInProject(orgA, 'not-a-uuid', link.project_id), false)
  })

  it('refuses to make a link into another organisation’s project', async () => {
    const b = await projectWithSequence(orgB)
    await assert.rejects(createLink(orgA, { projectId: b.project.id }), UnknownProjectError)
    assert.equal((await listLinks(orgB, b.project.id)).length, 0)
  })

  it('stops opening anything once revoked or expired', async () => {
    const a = await projectWithSequence(orgA)

    const revoked = await createLink(orgA, { projectId: a.project.id })
    assert.equal(await revokeLink(orgA, a.project.id, revoked.id), true)
    assert.equal(await revokeLink(orgA, a.project.id, revoked.id), false, 'revoking twice changes nothing')
    assert.equal(await getLinkByToken(revoked.token), null)

    const expired = await createLink(orgA, { projectId: a.project.id })
    await query(`update review_links set expires_at = now() - interval '1 second' where id = $1`, [expired.id])
    assert.equal(await getLinkByToken(expired.token), null)

    // Both still listed for the project page, with their state on them.
    const listed = await listLinks(orgA, a.project.id)
    assert.equal(listed.length, 2)
    assert.ok(listed.some(l => l.id === revoked.id && l.revoked_at !== null))

    assert.equal(await getLinkByToken(''), null)
    assert.equal(await getLinkByToken('x'.repeat(200)), null)
  })

  it('knows a guest by their address, within their link', async () => {
    const a = await projectWithSequence(orgA)
    const link = await createLink(orgA, { projectId: a.project.id })
    const otherLink = await createLink(orgA, { projectId: a.project.id })

    const first = await registerGuest(orgA, link.id, { name: 'Ana', email: 'Ana@Example.com' })
    const again = await registerGuest(orgA, link.id, { name: 'Ana García', email: 'ana@example.com' })
    assert.equal(again.id, first.id, 'the same address through the same link is the same guest')
    assert.equal(again.name, 'Ana García', 'with whatever name they gave this time')
    assert.equal(again.email, 'ana@example.com')

    assert.ok(await getGuest(orgA, link.id, first.id))
    assert.equal(await getGuest(orgA, otherLink.id, first.id), null, 'a guest belongs to one link')
    assert.equal(await getGuest(orgB, link.id, first.id), null)
    assert.equal(await getGuest(orgA, link.id, 'not-a-uuid'), null, 'a forged cookie is not found, not a crash')

    const withGuest = (await listLinks(orgA, a.project.id)).find(l => l.id === link.id)
    assert.deepEqual(withGuest?.guests.map(g => g.email), ['ana@example.com'])
  })

  it('signs what a guest writes as theirs', async () => {
    const a = await projectWithSequence(orgA)
    const link = await createLink(orgA, { projectId: a.project.id })
    const ana = await registerGuest(orgA, link.id, { name: 'Ana', email: 'ana@example.com' })
    const bo = await registerGuest(orgA, link.id, { name: 'Bo', email: 'bo@example.com' })

    const note = await createComment(orgA, {
      sequenceId: a.sequence.id,
      cueIndex: 1,
      lang: 'Spanish',
      body: 'too literal',
      guestId: ana.id,
    })
    assert.equal(note.author_id, null)
    assert.equal(note.guest_id, ana.id)

    const [listed] = await listComments(orgA, a.sequence.id)
    assert.equal(listed.author_name, 'Ana', 'the thread shows the guest by name')

    // Anyone may settle it, and the record says when.
    const settled = await setCommentResolved(orgA, a.sequence.id, note.id, true)
    assert.ok(settled?.resolved_at)
    const reopened = await setCommentResolved(orgA, a.sequence.id, note.id, false)
    assert.equal(reopened?.resolved_at, null)

    // Only the author may delete it — and only through the right sequence.
    const other = await projectWithSequence(orgA)
    assert.equal(await setCommentResolved(orgA, other.sequence.id, note.id, true), null)
    assert.equal(await deleteComment(orgA, a.sequence.id, note.id, { guestId: bo.id }), false)
    assert.equal(await deleteComment(orgA, a.sequence.id, note.id, { userId: 'user_a' }), false)
    assert.equal(await deleteComment(orgA, other.sequence.id, note.id, { guestId: ana.id }), false)
    assert.equal(await deleteComment(orgA, a.sequence.id, note.id, { guestId: ana.id }), true)
  })

  it('refuses a comment nobody wrote', async () => {
    const a = await projectWithSequence(orgA)
    await assert.rejects(
      createComment(orgA, { sequenceId: a.sequence.id, cueIndex: 1, body: 'orphan' }),
      /comments_author_or_guest/,
    )
  })

  it('records a guest’s edits as a version in their name', async () => {
    const a = await projectWithSequence(orgA)
    const link = await createLink(orgA, { projectId: a.project.id })
    const ana = await registerGuest(orgA, link.id, { name: 'Ana', email: 'ana@example.com' })

    const saved = await saveTextEdits(orgA, a.sequence.id, [{ lang: 'Spanish', index: 1, text: 'UNO' }], {
      guestId: ana.id,
    })
    assert.ok(saved)

    const [v] = await listVersions(orgA, a.sequence.id)
    assert.equal(v.guest_id, ana.id)
    assert.equal(v.created_by, null)
    assert.equal(v.author_name, 'Ana')
  })

  it('takes links, guests and their notes down with the organisation', async () => {
    const org = `test_org_${randomBytes(6).toString('hex')}`
    await query(
      'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
      [org, 'Efímera', org],
    )
    const a = await projectWithSequence(org)
    const link = await createLink(org, { projectId: a.project.id })
    const guest = await registerGuest(org, link.id, { name: 'Ana', email: 'ana@example.com' })
    await createComment(org, { sequenceId: a.sequence.id, cueIndex: 1, body: 'x', guestId: guest.id })

    await query('delete from "organization" where id = $1', [org])

    const count = async (table: string) =>
      (await query<{ n: number }>(`select count(*)::int as n from ${table} where org_id = $1`, [org]))[0].n
    assert.equal(await count('review_links'), 0)
    assert.equal(await count('review_guests'), 0)
    assert.equal(await count('comments'), 0)
  })
})
