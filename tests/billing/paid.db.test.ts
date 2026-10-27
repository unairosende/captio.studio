import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { billMedia, markSequencePaid } from '../../lib/db/billing.ts'
import { db, query, queryOne } from '../../lib/db/client.ts'
import { attachMedia, createMedia } from '../../lib/db/media.ts'
import { createProject } from '../../lib/db/projects.ts'
import { createSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * A sequence is paid for because its audio was — and only then.
 *
 * An upload attached to a sequence used to mark it paid whatever the upload
 * was. Since a picture can be swapped under imported cues, an upload nobody
 * transcribed reaches that path from the editor, and it would make every
 * translation of the import free.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const org = `test_org_${randomBytes(6).toString('hex')}`

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [org, `Productora ${org.slice(-4)}`, org],
  )
})

after(async () => {
  if (!HAS_DB) return
  await query('delete from "organization" where id = $1', [org])
  await db().end()
})

async function sequenceWithUpload(transcribed: boolean) {
  const project = await createProject(org, { name: 'Pagos' })
  const sequence = await createSequence(org, { projectId: project.id, name: 'Rollo 1' })
  const media = await createMedia(org, { storageKey: `${org}/${randomBytes(6).toString('hex')}.mp4`, contentType: 'video/mp4' })
  if (transcribed) await billMedia(org, media.id, 90)
  await attachMedia(org, media.id, sequence.id)
  await markSequencePaid(org, sequence.id)
  return queryOne<{ billed_at: string | null }>(
    `select billed_at from sequences where org_id = $1 and id = $2`,
    [org, sequence.id],
  )
}

describe('marking a sequence paid', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('does, once its upload was transcribed and charged', async () => {
    assert.ok((await sequenceWithUpload(true))?.billed_at)
  })

  it('does not, for an upload nobody transcribed', async () => {
    assert.equal((await sequenceWithUpload(false))?.billed_at, null)
  })
})
