import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import {
  billMedia,
  billSequence,
  currentMonthMediaSeconds,
  trialMediaSeconds,
} from '../../lib/db/billing.ts'
import { db, query, queryOne } from '../../lib/db/client.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * The month window and the charge-once rule, against a real Postgres.
 *
 * plan-limit.test.ts argues about the arithmetic; this is the half written in
 * SQL, which no pure test can reach: that the count starts again each calendar
 * month, and that the same material cannot be charged twice however many
 * languages it is later translated into.
 *
 * Worth a database because every way of getting it wrong is expensive and
 * quiet. Lose the date filter and the total becomes a lifetime one, so every
 * subscriber is walled a few months in having paid all along. Lose the
 * `billed_at is null` guard and "every language included" quietly becomes
 * "every language billed", which is the promise the pricing page makes in bold.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const org = `test_org_${randomBytes(6).toString('hex')}`
let projectId = ''

async function newOrg(id: string) {
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [id, `Productora ${id.slice(-4)}`, id],
  )
  const row = await queryOne<{ id: string }>(
    'insert into projects (org_id, name) values ($1, $2) returning id',
    [id, 'Facturación'],
  )
  return row!.id
}

/** An upload with a known duration, not yet charged. */
async function newMedia(orgId: string, seconds: number) {
  const row = await queryOne<{ id: string }>(
    `insert into media (org_id, storage_key, filename, duration_seconds)
     values ($1, $2, $3, $4) returning id`,
    [orgId, `test/${randomBytes(8).toString('hex')}.mp3`, 'reel.mp3', seconds],
  )
  return row!.id
}

async function newSequence(orgId: string, project: string) {
  const row = await queryOne<{ id: string }>(
    `insert into sequences (org_id, project_id, name, source_lang, target_langs, fps, data)
     values ($1, $2, $3, 'en', '{}', 25, '{}'::jsonb) returning id`,
    [orgId, project, 'Importado'],
  )
  return row!.id
}

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  projectId = await newOrg(org)
})

after(async () => {
  if (!HAS_DB) return
  // Everything cascades from the organisation.
  await query('delete from "organization" where id = $1', [org])
  await db().end()
})

describe('the minutes a plan includes', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('charges an upload once, however often it is asked for', async () => {
    const media = await newMedia(org, 600)

    assert.equal(await billMedia(org, media, 600), 600)
    // The second call is what a sixth language looks like from here.
    assert.equal(await billMedia(org, media, 600), 0)
    assert.equal(await currentMonthMediaSeconds(org), 600)
  })

  it('charges imported subtitles against the sequence, also once', async () => {
    const sequence = await newSequence(org, projectId)

    assert.equal(await billSequence(org, sequence, 300), 300)
    assert.equal(await billSequence(org, sequence, 300), 0)
    assert.equal(await currentMonthMediaSeconds(org), 900)
  })

  it('forgets what was charged last month', async () => {
    const media = await newMedia(org, 9_000)
    // Backdated by hand: billMedia always writes now(), and the whole question
    // here is what happens to a row on the far side of the boundary.
    await query(
      `update media set billed_seconds = 9000,
                        billed_at      = date_trunc('month', now()) - interval '1 day'
        where org_id = $1 and id = $2`,
      [org, media],
    )

    assert.equal(await currentMonthMediaSeconds(org), 900)
    // The trial has no clock, so the same row still counts against it.
    assert.equal(await trialMediaSeconds(org), 9_900)
  })

  it('keeps one organisation’s month out of another’s', async () => {
    const other = `test_org_${randomBytes(6).toString('hex')}`
    const otherProject = await newOrg(other)

    try {
      await billSequence(other, await newSequence(other, otherProject), 40_000)

      // Otherwise a busy neighbour spends this organisation's plan for them.
      assert.equal(await currentMonthMediaSeconds(org), 900)
      assert.equal(await currentMonthMediaSeconds(other), 40_000)
    } finally {
      await query('delete from "organization" where id = $1', [other])
    }
  })

  it('refuses to charge another organisation’s material', async () => {
    const other = `test_org_${randomBytes(6).toString('hex')}`
    await newOrg(other)

    try {
      const theirs = await newMedia(other, 1_200)

      // The org id comes from the session and the material id from a request,
      // so this is the exact shape a crafted mediaId would arrive in.
      assert.equal(await billMedia(org, theirs, 1_200), 0)
      assert.equal(await currentMonthMediaSeconds(other), 0)

      // Left untouched for its real owner, rather than quietly consumed.
      assert.equal(await billMedia(other, theirs, 1_200), 1_200)
    } finally {
      await query('delete from "organization" where id = $1', [other])
    }
  })
})
