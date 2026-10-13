import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import {
  billSequenceMaterial,
  currentMonthMediaSeconds,
  inheritPayment,
  markDerivativesPaid,
  markSequencePaid,
} from '../../lib/db/billing.ts'
import { db, query, queryOne } from '../../lib/db/client.ts'
import { attachMedia, playableMedia } from '../../lib/db/media.ts'
import { UnknownProjectError, createSequence, getSequence, updateSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * One material, two formats — against a real Postgres.
 *
 * A horizontal and a vertical cut of the same recording are two sequences
 * (migration 0014). The promise on the pricing page is about material, not
 * rows: the minutes are charged once, and both cuts have the picture. Each of
 * those is a statement in SQL, and each way of getting it wrong is quiet — a
 * second charge nobody can tell apart from the first, or a vertical cut that
 * opens to a black viewer.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const org = `test_org_${randomBytes(6).toString('hex')}`
const other = `test_org_${randomBytes(6).toString('hex')}`
let projectId = ''
let otherProject = ''

async function newOrg(id: string) {
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [id, `Productora ${id.slice(-4)}`, id],
  )
  const row = await queryOne<{ id: string }>(
    'insert into projects (org_id, name) values ($1, $2) returning id',
    [id, 'Dos formatos'],
  )
  return row!.id
}

/** A minute of cues — 00:00:00 to 00:01:00 — which is what an import is measured by. */
const MINUTE = {
  subtitles: [
    { index: 1, start: '00:00:00,000', end: '00:00:30,000', text: 'Uno' },
    { index: 2, start: '00:00:30,000', end: '00:01:00,000', text: 'Dos' },
  ],
  translations: {},
}

async function billedAt(id: string) {
  const row = await queryOne<{ billed_at: string | null; billed_seconds: number }>(
    'select billed_at, billed_seconds from sequences where id = $1',
    [id],
  )
  return row!
}

before(async () => {
  if (!HAS_DB) return
  await requireDisposableDatabase()
  projectId = await newOrg(org)
  otherProject = await newOrg(other)
})

after(async () => {
  if (!HAS_DB) return
  // Everything cascades from the organisation.
  await query('delete from "organization" where id = any($1)', [[org, other]])
  await db().end()
})

describe('one material in two formats', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('keeps the format with the sequence, and lets it change', async () => {
    const seq = await createSequence(org, { projectId, name: 'Vertical', outputMode: 'vertical' })
    assert.equal(seq.output_mode, 'vertical')

    const changed = await updateSequence(org, seq.id, { outputMode: 'horizontal' })
    assert.equal(changed?.output_mode, 'horizontal')
  })

  it('opens horizontal when nobody said otherwise', async () => {
    const seq = await createSequence(org, { projectId, name: 'Sin decir' })
    assert.equal(seq.output_mode, 'horizontal')
    assert.equal(seq.derived_from, null)
  })

  it('takes an origin only from the same project of the same organisation', async () => {
    const theirs = await createSequence(other, { projectId: otherProject, name: 'Suyo' })
    await assert.rejects(
      createSequence(org, { projectId, name: 'Robado', derivedFrom: theirs.id }),
      UnknownProjectError,
    )

    // Same organisation, another project: still not the same material.
    const elsewhere = await queryOne<{ id: string }>(
      'insert into projects (org_id, name) values ($1, $2) returning id',
      [org, 'Otro encargo'],
    )
    const there = await createSequence(org, { projectId: elsewhere!.id, name: 'Allí' })
    await assert.rejects(
      createSequence(org, { projectId, name: 'Cruzado', derivedFrom: there.id }),
      UnknownProjectError,
    )
  })

  it('charges an imported file once, whichever cut is translated first', async () => {
    const before = await currentMonthMediaSeconds(org)

    const h = await createSequence(org, { projectId, name: 'H', data: MINUTE })
    const v = await createSequence(org, {
      projectId, name: 'V', data: MINUTE, outputMode: 'vertical', derivedFrom: h.id,
    })

    // Nothing is paid yet, so the cut inherits nothing.
    await inheritPayment(org, v.id, h.id)
    assert.equal((await billedAt(v.id)).billed_at, null)

    // The vertical cut is translated first: the origin is what is charged.
    assert.equal(await billSequenceMaterial(org, v.id), true)
    assert.equal((await billedAt(h.id)).billed_seconds, 60)
    assert.ok((await billedAt(v.id)).billed_at, 'the cut is paid with its origin')
    assert.equal((await billedAt(v.id)).billed_seconds, 0)

    // Then the horizontal one, and the vertical again: nothing more.
    await billSequenceMaterial(org, h.id)
    await billSequenceMaterial(org, v.id)
    assert.equal(await currentMonthMediaSeconds(org), before + 60)
  })

  it('pays a cut made after its origin was paid', async () => {
    const h = await createSequence(org, { projectId, name: 'H pagada', data: MINUTE })
    await markSequencePaid(org, h.id)

    const v = await createSequence(org, { projectId, name: 'V', outputMode: 'vertical', derivedFrom: h.id })
    await inheritPayment(org, v.id, h.id)
    assert.ok((await billedAt(v.id)).billed_at)
    assert.equal((await billedAt(v.id)).billed_seconds, 0)
  })

  it('pays the cuts that already exist when the origin is paid', async () => {
    const h = await createSequence(org, { projectId, name: 'H', data: MINUTE })
    const v = await createSequence(org, { projectId, name: 'V', outputMode: 'vertical', derivedFrom: h.id })

    await markSequencePaid(org, h.id)
    await markDerivativesPaid(org, h.id)
    assert.ok((await billedAt(v.id)).billed_at)
  })

  it('never pays another organisation’s sequence', async () => {
    const theirs = await createSequence(other, { projectId: otherProject, name: 'Suyo' })
    const ours = await createSequence(org, { projectId, name: 'Nuestro' })
    await markSequencePaid(org, ours.id)

    // Named as an origin across the boundary, it is simply not found.
    await inheritPayment(other, theirs.id, ours.id)
    await markDerivativesPaid(other, ours.id)
    assert.equal((await billedAt(theirs.id)).billed_at, null)
    assert.equal(await billSequenceMaterial(other, ours.id), false)
  })

  it('plays the origin’s upload until the cut has one of its own', async () => {
    const h = await createSequence(org, { projectId, name: 'H', data: MINUTE })
    const v = await createSequence(org, { projectId, name: 'V', outputMode: 'vertical', derivedFrom: h.id })

    const upload = async (filename: string) => {
      const row = await queryOne<{ id: string }>(
        `insert into media (org_id, storage_key, filename, content_type)
         values ($1, $2, $3, 'video/mp4') returning id`,
        [org, `test/${randomBytes(8).toString('hex')}.mp4`, filename],
      )
      return row!.id
    }

    const first = await upload('rodaje.mp4')
    assert.equal(await attachMedia(org, first, h.id), true)
    assert.equal((await playableMedia(org, v.id))?.id, first)
    assert.equal((await playableMedia(org, h.id))?.id, first)

    const own = await upload('vertical.mp4')
    await attachMedia(org, own, v.id)
    assert.equal((await playableMedia(org, v.id))?.id, own)
    assert.equal((await playableMedia(org, h.id))?.id, first, 'the origin keeps its own')
  })

  it('leaves a cut standing on its own when the origin goes', async () => {
    const h = await createSequence(org, { projectId, name: 'H', data: MINUTE })
    const v = await createSequence(org, { projectId, name: 'V', outputMode: 'vertical', derivedFrom: h.id })

    await query('delete from sequences where org_id = $1 and id = $2', [org, h.id])
    assert.equal((await getSequence(org, v.id))?.derived_from, null)
  })
})
