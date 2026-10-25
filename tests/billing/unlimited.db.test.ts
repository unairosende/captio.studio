import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { billMedia } from '../../lib/db/billing.ts'
import { db, query, queryOne } from '../../lib/db/client.ts'
import { ownedByTeam } from '../../lib/db/organizations.ts'
import { checkAllowance, getEntitlement } from '../../lib/entitlement.ts'
import { TRIAL } from '../../lib/plans.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Our own organisations go uncapped, and nobody else's does.
 *
 * The grant is decided in SQL — owner, verified, domain or address — so only a database
 * can tell whether the wrong person gets it. Getting it wrong in that
 * direction is free provider spend for anybody who can type our domain.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const tag = randomBytes(6).toString('hex')
const orgs: string[] = []
const users: string[] = []

async function newUser(email: string, verified: boolean) {
  const id = `test_user_${randomBytes(6).toString('hex')}`
  await query(
    'insert into "user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, $4)',
    [id, 'Prueba', email, verified],
  )
  users.push(id)
  return id
}

async function newOrg(members: Array<[userId: string, role: string]>) {
  const id = `test_org_${randomBytes(6).toString('hex')}`
  await query(
    'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
    [id, `Productora ${id.slice(-4)}`, id],
  )
  for (const [userId, role] of members) {
    await query(
      `insert into member ("id", "organizationId", "userId", "role", "createdAt")
       values ($1, $2, $3, $4, now())`,
      [`test_member_${randomBytes(6).toString('hex')}`, id, userId, role],
    )
  }
  orgs.push(id)
  return id
}

before(async () => {
  if (HAS_DB) await requireDisposableDatabase()
})

after(async () => {
  if (!HAS_DB) return
  // Members and everything tenant-owned cascade from these two.
  await query('delete from "organization" where id = any($1)', [orgs])
  await query('delete from "user" where id = any($1)', [users])
  await db().end()
})

describe('unlimited organisations', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('lifts the wall for an organisation a verified team address owns', async () => {
    const org = await newOrg([[await newUser(`Ana.${tag}@Keweke.com`, true), 'owner']])

    // Spend the whole trial and then some: the wall would be up for anybody else.
    const media = await queryOne<{ id: string }>(
      `insert into media (org_id, storage_key, filename, duration_seconds)
       values ($1, $2, 'reel.mp3', 1) returning id`,
      [org, `test/${randomBytes(8).toString('hex')}.mp3`],
    )
    await billMedia(org, media!.id, TRIAL.mediaMinutes * 60 * 2)

    const entitlement = await getEntitlement(org)
    assert.equal(entitlement.status, 'subscribed')
    assert.equal(entitlement.monthly, null)
    assert.equal((await checkAllowance(org, 'transcribe')).allowed, true)
  })

  it('does not grant it to an address nobody has verified', async () => {
    const org = await newOrg([[await newUser(`intruso.${tag}@keweke.com`, false), 'owner']])
    assert.equal((await getEntitlement(org)).status, 'trial')
  })

  it('does not carry it into a customer organisation the team was invited to', async () => {
    const org = await newOrg([
      [await newUser(`cliente.${tag}@productora.example`, true), 'owner'],
      [await newUser(`bea.${tag}@keweke.com`, true), 'admin'],
    ])
    assert.equal((await getEntitlement(org)).status, 'trial')
  })

  it('matches the domain exactly, not as a suffix', async () => {
    const org = await newOrg([[await newUser(`eve.${tag}@notkeweke.com`, true), 'owner']])
    assert.equal((await getEntitlement(org)).status, 'trial')
  })

  // Through ownedByTeam with a list of our own: the real address may already
  // have a row here, and "user".email is unique.
  it('grants an exact address without granting the rest of its domain', async () => {
    const listed = [`unai.${tag}@gmail.example`]
    const ours = await newOrg([[await newUser(`Unai.${tag}@Gmail.example`, true), 'owner']])
    const stranger = await newOrg([[await newUser(`otro.${tag}@gmail.example`, true), 'owner']])

    assert.equal(await ownedByTeam(ours, [], listed), true)
    assert.equal(await ownedByTeam(stranger, [], listed), false)
  })

  it('does not grant an exact address nobody has verified', async () => {
    const listed = [`sinverificar.${tag}@gmail.example`]
    const org = await newOrg([[await newUser(listed[0], false), 'owner']])
    assert.equal(await ownedByTeam(org, [], listed), false)
  })
})
