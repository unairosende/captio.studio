import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createProject } from '../../lib/db/projects.ts'
import {
  ConflictError,
  createSequence,
  getSequence,
  listVersions,
  saveTextEdits,
} from '../../lib/db/sequences.ts'
import { UnknownCueError, readCues } from '../../lib/subtitles/data.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Text edits against a real Postgres: they land, they bump the version, they
 * leave a signed entry in the history, and a stale caller is refused rather
 * than allowed to overwrite somebody else's lines.
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

const cue = (index: number, text: string) =>
  ({ index, start: `00:00:0${index},000`, end: `00:00:0${index},500`, text })

async function sequence() {
  const project = await createProject(org, { name: 'Documental' })
  return createSequence(org, {
    projectId: project.id,
    name: 'Bobina',
    data: {
      subtitles: [cue(1, 'one'), cue(2, 'two')],
      translations: { Spanish: [cue(1, 'uno'), cue(2, 'dos')] },
      glossary: [{ term: 'kept' }],
    },
  })
}

describe('text edits against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('rewrites the words, bumps the version and signs the history', async () => {
    const s = await sequence()
    const saved = await saveTextEdits(org, s.id, [{ lang: 'Spanish', index: 2, text: 'DOS' }], {
      expectedVersion: s.version,
      guestId: null,
      createdBy: 'user_a',
    })
    assert.ok(saved)
    assert.equal(saved.version, s.version + 1)

    const { translations } = readCues(saved.data)
    assert.equal(translations.Spanish[1].text, 'DOS')
    assert.deepEqual((saved.data as { glossary: unknown }).glossary, [{ term: 'kept' }], 'the rest of the blob travels through')

    const [v] = await listVersions(org, s.id)
    assert.equal(v.created_by, 'user_a')
    assert.equal(v.version, saved.version)
  })

  it('refuses a stale caller instead of overwriting', async () => {
    const s = await sequence()
    await saveTextEdits(org, s.id, [{ lang: 'source', index: 1, text: 'ONE' }], { createdBy: 'user_a' })

    await assert.rejects(
      saveTextEdits(org, s.id, [{ lang: 'source', index: 1, text: 'LOST' }], {
        expectedVersion: s.version,
        createdBy: 'user_b',
      }),
      ConflictError,
    )
    const now = await getSequence(org, s.id)
    assert.equal(readCues(now?.data).subtitles[0].text, 'ONE', 'the first edit stands')
  })

  it('writes nothing when an edit names a cue that is not there', async () => {
    const s = await sequence()
    await assert.rejects(
      saveTextEdits(org, s.id, [
        { lang: 'Spanish', index: 1, text: 'fine' },
        { lang: 'Spanish', index: 7, text: 'nowhere' },
      ]),
      UnknownCueError,
    )
    const now = await getSequence(org, s.id)
    assert.equal(now?.version, s.version)
    assert.equal(readCues(now?.data).translations.Spanish[0].text, 'uno')
    assert.equal((await listVersions(org, s.id)).length, 0)
  })
})
