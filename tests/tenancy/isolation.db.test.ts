import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createClient, getClient, listClients, updateClient } from '../../lib/db/clients.ts'
import { createProject, deleteProject, duplicateProject, getProject, listProjects, updateProject } from '../../lib/db/projects.ts'
import {
  ConflictError,
  UnknownProjectError,
  createSequence,
  deleteSequence,
  duplicateSequence,
  getSequence,
  listRelatedTracks,
  listSequences,
  listVersions,
  snapshotSequence,
  updateSequence,
} from '../../lib/db/sequences.ts'
import { createComment, deleteComment, listComments } from '../../lib/db/comments.ts'
import { currentMonthCostUsd, logUsage } from '../../lib/db/billing.ts'
import { createMedia, getMedia, playableMedia, playableMediaInProject } from '../../lib/db/media.ts'
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

    it('duplicates a project with its sequences and what each one plays, and nothing of anyone else', async () => {
      const p = await createProject(orgA, { name: 'Serie', glossary: [{ term: 'Nautilus' }] })
      const seq = await createSequence(orgA, { projectId: p.id, name: 'Episodio 1', data: { subtitles: [] } })
      await createMedia(orgA, { sequenceId: seq.id, storageKey: `${orgA}/ep1.mp4`, contentType: 'video/mp4', filename: 'ep1.mp4' })
      await query(`update sequences set billed_seconds = 600, billed_at = now() where org_id = $1 and id = $2`, [orgA, seq.id])

      const [media] = await playableMediaInProject(orgA, p.id)
      const copy = await duplicateProject(orgA, p.id, 'Serie (copia)', null, [{ id: media.id, storageKey: `${orgA}/ep1-copy.mp4` }])
      assert.ok(copy)
      assert.deepEqual(copy.glossary, [{ term: 'Nautilus' }])

      const [copied] = await listSequences(orgA, copy.id)
      assert.equal(copied.name, 'Episodio 1')
      assert.notEqual(copied.id, seq.id)
      // The copied object, through a row of its own.
      assert.equal((await playableMedia(orgA, copied.id))?.storage_key, `${orgA}/ep1-copy.mp4`)
      // Already paid for, and not counted a second time.
      const [billing] = await query<{ billed_seconds: number; billed_at: string | null }>(
        `select billed_seconds, billed_at from sequences where org_id = $1 and id = $2`, [orgA, copied.id])
      assert.equal(billing.billed_seconds, 0)
      assert.ok(billing.billed_at)
      // The original keeps everything it had.
      assert.equal((await listSequences(orgA, p.id)).length, 1)
    })

    it('refuses cross-organisation writes and deletes', async () => {
      const p = await createProject(orgA, { name: 'Contenedor' })
      const a = await createSequence(orgA, { projectId: p.id, name: 'Original' })

      assert.equal(await updateSequence(orgB, a.id, { name: 'Hijacked' }), null)
      assert.equal(await deleteSequence(orgB, a.id), false)
      assert.equal(await duplicateSequence(orgB, a.id, 'Stolen copy'), null)
      assert.equal(await duplicateProject(orgB, p.id, 'Stolen project'), null)
      assert.deepEqual(await playableMediaInProject(orgB, p.id), [])
      assert.equal(await deleteProject(orgB, p.id), false)

      // The row is untouched and still A's.
      const survivor = await getSequence(orgA, a.id)
      assert.equal(survivor?.name, 'Original')
    })

    it('keeps clients, and their glossaries, inside the organisation', async () => {
      const clientA = await createClient(orgA, { name: 'Bodega A' })
      await updateClient(orgA, clientA.id, { glossary: [{ term: 'Reserva de la Familia' }] })

      assert.ok((await listClients(orgB)).every(c => c.id !== clientA.id))
      assert.equal(await getClient(orgB, clientA.id), null)
      assert.equal(await updateClient(orgB, clientA.id, { name: 'Hijacked' }), null)
      assert.equal((await getClient(orgA, clientA.id))?.name, 'Bodega A')
    })

    it('refuses to file a project under another organisation’s client', async () => {
      const clientA = await createClient(orgA, { name: 'Cliente A' })
      const projectA = await createProject(orgA, { name: 'Del cliente' })
      const projectB = await createProject(orgB, { name: 'Ajeno' })

      // The foreign key would accept this: the client exists. The scoped lookup
      // inside the UPDATE is what finds nothing and leaves B unassigned.
      await updateProject(orgB, projectB.id, { clientId: clientA.id })
      assert.equal((await getProject(orgB, projectB.id))?.client_id, null)

      await updateProject(orgA, projectA.id, { clientId: clientA.id })
      const filed = await getProject(orgA, projectA.id)
      assert.equal(filed?.client_id, clientA.id)
      assert.equal(filed?.client_name, 'Cliente A')

      await updateProject(orgA, projectA.id, { clientId: null })
      assert.equal((await getProject(orgA, projectA.id))?.client_id, null)
    })

    it('learns only from its own organisation’s tracks, and its client’s', async () => {
      const client = await createClient(orgA, { name: 'Cliente con pistas' })
      const one = await createProject(orgA, { name: 'Uno' })
      const two = await createProject(orgA, { name: 'Dos' })
      const loose = await createProject(orgA, { name: 'Suelto' })
      await updateProject(orgA, one.id, { clientId: client.id })
      await updateProject(orgA, two.id, { clientId: client.id })
      for (const p of [one, two, loose]) await createSequence(orgA, { projectId: p.id, name: p.name })

      const related = new Set((await listRelatedTracks(orgA, one.id)).map(t => t.project_id))
      assert.deepEqual(related, new Set([one.id, two.id]))
      assert.deepEqual((await listRelatedTracks(orgA, loose.id)).map(t => t.project_id), [loose.id])
      assert.deepEqual(await listRelatedTracks(orgB, one.id), [])
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

    it('does not let one organisation reach another’s media', async () => {
      // Two lookups hand out the bucket: getMedia by id (transcription) and
      // playableMedia by sequence, which is what signs the playback URL the
      // editor and the review link open. A row from another organisation has to
      // come back not-found from both, or a signed URL for somebody else’s
      // recording is one guessed id away.
      const p = await createProject(orgA, { name: 'Con audio' })
      const seq = await createSequence(orgA, { projectId: p.id, name: 'Bobina' })
      const media = await createMedia(orgA, {
        sequenceId: seq.id,
        storageKey: 'orgA/clip.wav',
        filename: 'clip.wav',
        contentType: 'audio/wav',
      })
      const madeUp = '00000000-0000-0000-0000-000000000000'

      assert.equal((await getMedia(orgA, media.id))?.id, media.id)
      assert.equal(await getMedia(orgB, media.id), null)
      assert.equal(await getMedia(orgB, madeUp), null)

      assert.equal((await playableMedia(orgA, seq.id))?.id, media.id)
      assert.equal(await playableMedia(orgB, seq.id), null)
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
      assert.equal(await deleteComment(orgA, a.id, c.id, { userId: 'user_b' }), false)
      assert.equal(await deleteComment(orgA, a.id, c.id, { userId: 'user_a' }), true)
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
