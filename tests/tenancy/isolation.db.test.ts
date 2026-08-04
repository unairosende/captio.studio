import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import {
  ConflictError,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  listProjects,
  listVersions,
  snapshotProject,
  updateProject,
} from '../../lib/db/projects.ts'
import { createComment, deleteComment, listComments } from '../../lib/db/comments.ts'
import { currentMonthCostUsd, logUsage } from '../../lib/db/billing.ts'

/**
 * Isolation, proven against a real Postgres.
 *
 * `scoping.test.ts` reads the SQL and argues the filters are there. This runs
 * the queries and shows that they hold — the two answer different questions and
 * neither replaces the other.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 *
 * Every row it writes is namespaced by a random org id and removed afterwards,
 * so it is safe against a development database and never collides with real
 * organisations.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const orgA = `test_org_${randomBytes(6).toString('hex')}`
const orgB = `test_org_${randomBytes(6).toString('hex')}`

after(async () => {
  if (!HAS_DB) return
  for (const org of [orgA, orgB]) {
    await query('delete from usage_events where org_id = $1', [org])
    await query('delete from comments where org_id = $1', [org])
    await query('delete from project_versions where org_id = $1', [org])
    await query('delete from projects where org_id = $1', [org])
  }
  await db().end()
})

describe(
  'tenant isolation against a live database',
  { skip: !HAS_DB && 'DATABASE_URL not set' },
  () => {
    it('never shows one organisation another organisation’s projects', async () => {
      const a = await createProject(orgA, { name: 'Documental A', fps: 25 })
      await createProject(orgB, { name: 'Serie B', fps: 23.976 })

      const listA = await listProjects(orgA)
      assert.equal(listA.length, 1)
      assert.equal(listA[0].name, 'Documental A')
      assert.ok(listA.every(p => p.org_id === orgA))

      // B holds a valid project id belonging to A. That must not be enough.
      assert.equal(await getProject(orgB, a.id), null)
    })

    it('refuses cross-organisation writes and deletes', async () => {
      const a = await createProject(orgA, { name: 'Original' })

      assert.equal(await updateProject(orgB, a.id, { name: 'Hijacked' }), null)
      assert.equal(await deleteProject(orgB, a.id), false)
      assert.equal(await duplicateProject(orgB, a.id, 'Stolen copy'), null)

      // The row is untouched and still A's.
      const survivor = await getProject(orgA, a.id)
      assert.equal(survivor?.name, 'Original')
    })

    it('does not leak whether a project id exists', async () => {
      const a = await createProject(orgA, { name: 'Secreto' })
      const madeUp = '00000000-0000-0000-0000-000000000000'

      // A real id owned by someone else and an id that never existed must be
      // indistinguishable, or the API becomes an enumeration oracle.
      assert.equal(await getProject(orgB, a.id), null)
      assert.equal(await getProject(orgB, madeUp), null)
    })

    it('keeps snapshots and comments inside the organisation', async () => {
      const a = await createProject(orgA, { name: 'Con historial', data: { cues: [1, 2, 3] } })

      const snap = await snapshotProject(orgA, a.id)
      assert.ok(snap)
      assert.equal((await listVersions(orgA, a.id)).length, 1)
      assert.equal((await listVersions(orgB, a.id)).length, 0)

      // B cannot snapshot A's project either.
      assert.equal(await snapshotProject(orgB, a.id), null)

      await createComment(orgA, {
        projectId: a.id,
        cueIndex: 4,
        body: 'Revisar este plano',
        authorId: 'user_a',
      })
      assert.equal((await listComments(orgA, a.id)).length, 1)
      assert.equal((await listComments(orgB, a.id)).length, 0)
    })

    it('lets only the author delete their own comment', async () => {
      const a = await createProject(orgA, { name: 'Comentado' })
      const c = await createComment(orgA, {
        projectId: a.id,
        cueIndex: 1,
        body: 'mío',
        authorId: 'user_a',
      })

      // Same org, different person: org scope alone must not be enough.
      assert.equal(await deleteComment(orgA, c.id, 'user_b'), false)
      assert.equal(await deleteComment(orgA, c.id, 'user_a'), true)
    })

    it('meters usage per organisation', async () => {
      const a = await createProject(orgA, { name: 'Medido' })
      await logUsage({ orgId: orgA, projectId: a.id, kind: 'translate', model: 'x', costUsd: 1.5 })
      await logUsage({ orgId: orgB, kind: 'translate', model: 'x', costUsd: 99 })

      assert.equal(await currentMonthCostUsd(orgA), 1.5)
      assert.equal(await currentMonthCostUsd(orgB), 99)
    })

    it('lets exactly one of two simultaneous saves win', async () => {
      const a = await createProject(orgA, { name: 'Disputado', data: { v: 0 } })
      const seen = a.version

      const first = await updateProject(orgA, a.id, { data: { v: 1 } }, { expectedVersion: seen })
      assert.ok(first)
      assert.equal(first.version, seen + 1)

      // The second editor still holds the version it read before the first save.
      await assert.rejects(
        () => updateProject(orgA, a.id, { data: { v: 2 } }, { expectedVersion: seen }),
        (err: Error) => err instanceof ConflictError,
      )

      const final = await getProject(orgA, a.id)
      assert.deepEqual(final?.data, { v: 1 })
    })

    it('accepts the next save once the editor reloads the current version', async () => {
      const a = await createProject(orgA, { name: 'Reintento', data: { v: 0 } })

      const saved = await updateProject(orgA, a.id, { data: { v: 1 } }, { expectedVersion: a.version })
      assert.ok(saved)

      // A conflict must be recoverable, not a dead end: reload, then save again.
      const again = await updateProject(
        orgA,
        a.id,
        { data: { v: 2 } },
        { expectedVersion: saved.version },
      )
      assert.ok(again)
      assert.deepEqual(again.data, { v: 2 })
    })

    it('cascades project deletion to its attachments', async () => {
      const a = await createProject(orgA, { name: 'Efímero' })
      await snapshotProject(orgA, a.id)
      await createComment(orgA, { projectId: a.id, cueIndex: 1, body: 'x', authorId: 'user_a' })

      assert.equal(await deleteProject(orgA, a.id), true)
      assert.equal((await listVersions(orgA, a.id)).length, 0)
      assert.equal((await listComments(orgA, a.id)).length, 0)
    })
  },
)
