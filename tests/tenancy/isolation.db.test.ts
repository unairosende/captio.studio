import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createProject, deleteProject, getProject, listProjects } from '../../lib/db/projects.ts'
import {
  ConflictError,
  UnknownProjectError,
  createSequence,
  deleteSequence,
  duplicateSequence,
  getSequence,
  listSequences,
  listVersions,
  snapshotSequence,
  updateSequence,
} from '../../lib/db/sequences.ts'
import { createComment, deleteComment, listComments } from '../../lib/db/comments.ts'
import { currentMonthCostUsd, logUsage } from '../../lib/db/billing.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

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

// org_id is a foreign key to Better Auth's `organization`, so these have to be
// real rows. That is the point: the test exercises the same referential rules
// production does, instead of inventing ids the database would reject.
before(async () => {
  if (!HAS_DB) return
  // Before writing anything, make the database confirm it is disposable.
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
  // Deleting the organisation is enough — projects, sequences, versions,
  // comments, media and metering all cascade from it. If that ever stops being
  // true, rows will pile up here and the next run will notice.
  await query('delete from "organization" where id = any($1)', [[orgA, orgB]])
  await db().end()
})

describe(
  'tenant isolation against a live database',
  { skip: !HAS_DB && 'DATABASE_URL not set' },
  () => {
    it('never shows one organisation another organisation’s projects', async () => {
      const a = await createProject(orgA, { name: 'Documental A' })
      await createProject(orgB, { name: 'Serie B' })

      const listA = await listProjects(orgA)
      assert.equal(listA.length, 1)
      assert.equal(listA[0].name, 'Documental A')
      assert.ok(listA.every(p => p.org_id === orgA))

      // B holds a valid project id belonging to A. That must not be enough.
      assert.equal(await getProject(orgB, a.id), null)
    })

    it('refuses to put a sequence in another organisation’s project', async () => {
      const a = await createProject(orgA, { name: 'Ajeno' })

      // The foreign key would accept this happily: the project exists. Only the
      // scoped check inside the INSERT knows it is not B's to write into.
      await assert.rejects(
        () => createSequence(orgB, { projectId: a.id, name: 'Colada' }),
        (err: Error) => err instanceof UnknownProjectError,
      )
      assert.equal((await listSequences(orgA, a.id)).length, 0)
    })

    it('refuses to move a sequence into another organisation’s project', async () => {
      const projectA = await createProject(orgA, { name: 'Origen' })
      const projectB = await createProject(orgB, { name: 'Destino ajeno' })
      const seq = await createSequence(orgA, { projectId: projectA.id, name: 'Bobina 1' })

      // A owns the sequence but not the destination, so the scoped lookup finds
      // nothing and the NOT NULL column refuses what it resolves to.
      await assert.rejects(() =>
        updateSequence(orgA, seq.id, { projectId: projectB.id }),
      )

      const survivor = await getSequence(orgA, seq.id)
      assert.equal(survivor?.project_id, projectA.id)
    })

    it('refuses cross-organisation writes and deletes', async () => {
      const p = await createProject(orgA, { name: 'Contenedor' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Original' })

      assert.equal(await updateSequence(orgB, a.id, { name: 'Hijacked' }), null)
      assert.equal(await deleteSequence(orgB, a.id), false)
      assert.equal(await duplicateSequence(orgB, a.id, 'Stolen copy'), null)
      assert.equal(await deleteProject(orgB, p.id), false)

      // The row is untouched and still A's.
      const survivor = await getSequence(orgA, a.id)
      assert.equal(survivor?.name, 'Original')
    })

    it('does not leak whether an id exists', async () => {
      const p = await createProject(orgA, { name: 'Secreto' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Secreta' })
      const madeUp = '00000000-0000-0000-0000-000000000000'

      // A real id owned by someone else and an id that never existed must be
      // indistinguishable, or the API becomes an enumeration oracle.
      assert.equal(await getSequence(orgB, a.id), null)
      assert.equal(await getSequence(orgB, madeUp), null)
      assert.equal(await getProject(orgB, p.id), null)
      assert.equal(await getProject(orgB, madeUp), null)
    })

    it('keeps snapshots and comments inside the organisation', async () => {
      const p = await createProject(orgA, { name: 'Con historial' })
      const a = await createSequence(orgA, {
        projectId: p.id,
        name: 'Bobina',
        data: { cues: [1, 2, 3] },
      })

      const snap = await snapshotSequence(orgA, a.id)
      assert.ok(snap)
      assert.equal((await listVersions(orgA, a.id)).length, 1)
      assert.equal((await listVersions(orgB, a.id)).length, 0)

      // B cannot snapshot A's sequence either.
      assert.equal(await snapshotSequence(orgB, a.id), null)

      await createComment(orgA, {
        sequenceId: a.id,
        cueIndex: 4,
        body: 'Revisar este plano',
        authorId: 'user_a',
      })
      assert.equal((await listComments(orgA, a.id)).length, 1)
      assert.equal((await listComments(orgB, a.id)).length, 0)
    })

    it('lets only the author delete their own comment', async () => {
      const p = await createProject(orgA, { name: 'Comentado' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Bobina' })
      const c = await createComment(orgA, {
        sequenceId: a.id,
        cueIndex: 1,
        body: 'mío',
        authorId: 'user_a',
      })

      // Same org, different person: org scope alone must not be enough.
      assert.equal(await deleteComment(orgA, c.id, 'user_b'), false)
      assert.equal(await deleteComment(orgA, c.id, 'user_a'), true)
    })

    it('meters usage per organisation', async () => {
      const p = await createProject(orgA, { name: 'Medido' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Bobina' })
      await logUsage({ orgId: orgA, sequenceId: a.id, kind: 'translate', model: 'x', costUsd: 1.5 })
      await logUsage({ orgId: orgB, kind: 'translate', model: 'x', costUsd: 99 })

      assert.equal(await currentMonthCostUsd(orgA), 1.5)
      assert.equal(await currentMonthCostUsd(orgB), 99)
    })

    it('lets exactly one of two simultaneous saves win', async () => {
      const p = await createProject(orgA, { name: 'Contenedor' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Disputado', data: { v: 0 } })
      const seen = a.version

      const first = await updateSequence(orgA, a.id, { data: { v: 1 } }, { expectedVersion: seen })
      assert.ok(first)
      assert.equal(first.version, seen + 1)

      // The second editor still holds the version it read before the first save.
      await assert.rejects(
        () => updateSequence(orgA, a.id, { data: { v: 2 } }, { expectedVersion: seen }),
        (err: Error) => err instanceof ConflictError,
      )

      const final = await getSequence(orgA, a.id)
      assert.deepEqual(final?.data, { v: 1 })
    })

    it('accepts the next save once the editor reloads the current version', async () => {
      const p = await createProject(orgA, { name: 'Contenedor' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Reintento', data: { v: 0 } })

      const saved = await updateSequence(
        orgA,
        a.id,
        { data: { v: 1 } },
        { expectedVersion: a.version },
      )
      assert.ok(saved)

      // A conflict must be recoverable, not a dead end: reload, then save again.
      const again = await updateSequence(
        orgA,
        a.id,
        { data: { v: 2 } },
        { expectedVersion: saved.version },
      )
      assert.ok(again)
      assert.deepEqual(again.data, { v: 2 })
    })

    it('cascades sequence deletion to its attachments', async () => {
      const p = await createProject(orgA, { name: 'Contenedor' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Efímero' })
      await snapshotSequence(orgA, a.id)
      await createComment(orgA, { sequenceId: a.id, cueIndex: 1, body: 'x', authorId: 'user_a' })

      assert.equal(await deleteSequence(orgA, a.id), true)
      assert.equal((await listVersions(orgA, a.id)).length, 0)
      assert.equal((await listComments(orgA, a.id)).length, 0)
    })

    it('cascades project deletion all the way down', async () => {
      // The reason the delete confirmation has to say how many sequences are
      // inside: this is not a folder that empties, it is everything going.
      const p = await createProject(orgA, { name: 'Todo el trabajo' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Bobina 1' })
      await createSequence(orgA, { projectId: p.id, name: 'Bobina 2' })
      await snapshotSequence(orgA, a.id)
      await createComment(orgA, { sequenceId: a.id, cueIndex: 1, body: 'x', authorId: 'user_a' })

      assert.equal(await deleteProject(orgA, p.id), true)
      assert.equal((await listSequences(orgA, p.id)).length, 0)
      assert.equal(await getSequence(orgA, a.id), null)
      assert.equal((await listVersions(orgA, a.id)).length, 0)
      assert.equal((await listComments(orgA, a.id)).length, 0)
    })

    it('counts what is inside a project without opening it', async () => {
      const p = await createProject(orgA, { name: 'Resumen' })
      await createSequence(orgA, {
        projectId: p.id,
        name: 'Bobina 1',
        targetLangs: ['Spanish', 'French'],
        data: { subtitles: [1, 2, 3] },
      })
      await createSequence(orgA, {
        projectId: p.id,
        name: 'Bobina 2',
        targetLangs: ['Spanish'],
        data: { subtitles: [1, 2] },
      })

      const summary = await getProject(orgA, p.id)
      assert.equal(summary?.sequence_count, 2)
      // Five cues across two sequences — and not fifteen, which is what counting
      // through the language unnest would give.
      assert.equal(summary?.cue_count, 5)
      assert.deepEqual(summary?.target_langs, ['French', 'Spanish'])
    })

    it('survives a sequence whose data holds no cue array at all', async () => {
      // `data` is free-form jsonb. jsonb_array_length raises on anything that is
      // not an array, so one such row would take the whole listing down.
      const p = await createProject(orgA, { name: 'Raro' })
      await createSequence(orgA, { projectId: p.id, name: 'Vacía', data: {} })
      await createSequence(orgA, { projectId: p.id, name: 'Rara', data: { subtitles: 'nope' } })

      const summary = await getProject(orgA, p.id)
      assert.equal(summary?.cue_count, 0)
      assert.equal((await listSequences(orgA, p.id)).every(s => s.cue_count === 0), true)
    })
  },
)
