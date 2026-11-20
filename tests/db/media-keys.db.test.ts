import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createMedia, projectStorageKeys, sequenceStorageKeys } from '../../lib/db/media.ts'
import { createProject, deleteProject } from '../../lib/db/projects.ts'
import { createSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Which objects go when a project or a sequence is deleted.
 *
 * Deleting either cascades the media rows away, and they were the only record of
 * the keys: a project deleted before lib/erasure.ts read them first left its
 * video in the bucket for ever. These keys are what gets deleted from R2, so a
 * query that reaches too far deletes somebody else's footage, and one that falls
 * short is that same leak again.
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

async function sequenceWithMedia(orgId: string, projectId: string, key: string) {
  const seq = await createSequence(orgId, { projectId, name: key, data: { subtitles: [] } })
  await createMedia(orgId, { sequenceId: seq.id, storageKey: key })
  return seq
}

describe('storage keys behind a project or a sequence', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('names every object of the project, and nothing outside it', async () => {
    const tag = randomBytes(4).toString('hex')
    const film = await createProject(org, { name: 'Documental' })
    const promo = await createProject(org, { name: 'Promo' })
    const first = await sequenceWithMedia(org, film.id, `${org}/${tag}-a1`)
    await sequenceWithMedia(org, film.id, `${org}/${tag}-a2`)
    await sequenceWithMedia(org, promo.id, `${org}/${tag}-b1`)
    await createMedia(org, { storageKey: `${org}/${tag}-loose` })

    const theirs = await createProject(other, { name: 'Ajeno' })
    const foreign = await sequenceWithMedia(other, theirs.id, `${other}/${tag}-x`)

    assert.deepEqual((await projectStorageKeys(org, film.id)).sort(), [
      `${org}/${tag}-a1`,
      `${org}/${tag}-a2`,
    ])
    assert.deepEqual(await sequenceStorageKeys(org, first.id), [`${org}/${tag}-a1`])

    // Another organisation's ids find nothing, so its footage cannot be deleted from here.
    assert.deepEqual(await projectStorageKeys(org, theirs.id), [])
    assert.deepEqual(await sequenceStorageKeys(org, foreign.id), [])
  })

  it('loses the keys with the rows, which is why they are read first', async () => {
    const tag = randomBytes(4).toString('hex')
    const film = await createProject(org, { name: 'Documental' })
    await sequenceWithMedia(org, film.id, `${org}/${tag}-gone`)

    assert.equal((await projectStorageKeys(org, film.id)).length, 1)
    await deleteProject(org, film.id)
    assert.deepEqual(await projectStorageKeys(org, film.id), [])
  })
})
