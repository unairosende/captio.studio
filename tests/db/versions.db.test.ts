import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createProject } from '../../lib/db/projects.ts'
import {
  createSequence,
  getVersion,
  listVersions,
  updateSequence,
} from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Every save is a version, against a real Postgres.
 *
 * `sequence_versions` existed from the first migration and nothing wrote to it.
 * Now `updateSequence` records one whenever the cues change, in the same
 * transaction as the cues — and folds a run of saves by the same person into
 * one entry, so a client correcting thirty lines leaves one version, not thirty.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const org = `test_org_${randomBytes(6).toString('hex')}`
const other = `test_org_${randomBytes(6).toString('hex')}`

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  for (const id of [org, other]) {
    await query(
      'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
      [id, `Productora ${id.slice(-4)}`, id],
    )
  }
})

after(async () => {
  if (!HAS_DB) return
  await query('delete from "organization" where id = any($1)', [[org, other]])
  await db().end()
})

async function sequence() {
  const project = await createProject(org, { name: 'Documental' })
  return createSequence(org, {
    projectId: project.id,
    name: 'Bobina',
    data: { subtitles: [{ index: 1, start: '00:00:01,000', end: '00:00:02,000', text: 'a' }] },
  })
}

describe('versions against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('records a version on every save of the cues, signed and numbered', async () => {
    const s = await sequence()
    assert.equal((await listVersions(org, s.id)).length, 0, 'creating is not saving')

    const saved = await updateSequence(org, s.id, { data: { subtitles: [] } }, {
      createdBy: 'user_a',
      note: 'first pass',
    })
    assert.ok(saved)

    const [v] = await listVersions(org, s.id)
    assert.equal(v.version, saved.version, 'the version is called by the counter of the save')
    assert.equal(v.created_by, 'user_a')
    assert.equal(v.guest_id, null)
    assert.equal(v.note, 'first pass')

    const full = await getVersion(org, s.id, v.id)
    assert.deepEqual(full?.data, { subtitles: [] }, 'the version holds what was saved')
  })

  it('does not record a rename as a version', async () => {
    const s = await sequence()
    await updateSequence(org, s.id, { name: 'Bobina 2' })
    assert.equal((await listVersions(org, s.id)).length, 0)
  })

  it('folds a burst of saves by the same person into one version', async () => {
    const s = await sequence()
    const first = await updateSequence(org, s.id, { data: { n: 1 } }, { createdBy: 'user_a' })
    const second = await updateSequence(org, s.id, { data: { n: 2 } }, {
      createdBy: 'user_a',
      note: 'kept the note',
    })
    assert.ok(first && second)

    const versions = await listVersions(org, s.id)
    assert.equal(versions.length, 1, 'two saves in one sitting are one version')
    assert.equal(versions[0].version, second.version, 'the entry follows the latest save')
    assert.equal(versions[0].note, 'kept the note')
    assert.deepEqual((await getVersion(org, s.id, versions[0].id))?.data, { n: 2 })
  })

  it('starts a new version when somebody else saves', async () => {
    const s = await sequence()
    await updateSequence(org, s.id, { data: { n: 1 } }, { createdBy: 'user_a' })
    await updateSequence(org, s.id, { data: { n: 2 } }, { createdBy: 'user_b' })
    // Back to A: B's save sits between, so this is a third entry, not a
    // continuation of A's first one.
    await updateSequence(org, s.id, { data: { n: 3 } }, { createdBy: 'user_a' })

    const authors = (await listVersions(org, s.id)).map(v => v.created_by)
    assert.deepEqual(authors, ['user_a', 'user_b', 'user_a'])
  })

  it('never continues a burst on behalf of nobody', async () => {
    const s = await sequence()
    await updateSequence(org, s.id, { data: { n: 1 } })
    await updateSequence(org, s.id, { data: { n: 2 } })
    assert.equal((await listVersions(org, s.id)).length, 2, 'anonymous saves cannot be "the same person"')
  })

  it('keeps a version behind its own sequence', async () => {
    const a = await sequence()
    const b = await sequence()
    await updateSequence(org, a.id, { data: { n: 1 } }, { createdBy: 'user_a' })
    const [v] = await listVersions(org, a.id)

    assert.ok(await getVersion(org, a.id, v.id))
    assert.equal(await getVersion(org, b.id, v.id), null, 'the right id under the wrong sequence')
    assert.equal(await getVersion(other, a.id, v.id), null, 'or the wrong organisation')
    assert.equal(await getVersion(org, a.id, 'not-a-uuid'), null, 'a malformed id is not found, not a crash')
  })

  it('rolls the version back with a refused save', async () => {
    const s = await sequence()
    await assert.rejects(
      updateSequence(org, s.id, { data: { n: 1 } }, { expectedVersion: 999, createdBy: 'user_a' }),
    )
    assert.equal((await listVersions(org, s.id)).length, 0, 'a save that did not happen has no version')
  })
})
