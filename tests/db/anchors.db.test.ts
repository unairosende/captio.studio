import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'
import { createComment, listComments } from '../../lib/db/comments.ts'
import { createProject } from '../../lib/db/projects.ts'
import { ConflictError, createSequence, updateSequence } from '../../lib/db/sequences.ts'
import { requireDisposableDatabase } from '../support/disposable-db.ts'

/**
 * Comment anchors, moved by a real save against a real Postgres.
 *
 * `anchors.test.ts` next door checks what the route will accept, and
 * `store/structural.test.ts` checks what the editor records. Neither runs the
 * UPDATE, and the UPDATE is where this goes wrong quietly: cues live in a jsonb
 * blob and comments live in their own table, so nothing in the schema ties the
 * two together. A shift that does not happen leaves every note below the edit
 * quoting a line nobody wrote, on a screen that looks entirely normal.
 *
 * The last test is the reason `updateSequence` opens a transaction at all.
 *
 * Runs only when DATABASE_URL is set:
 *   npm run test:db
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)
const orgA = `test_org_${randomBytes(6).toString('hex')}`
const orgB = `test_org_${randomBytes(6).toString('hex')}`

before(async () => {
  if (!HAS_DB) return
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
  // Projects and comments cascade from the organisation, as they do next door.
  await query('delete from "organization" where id = any($1)', [[orgA, orgB]])
  await db().end()
})

/** Each note and the cue it sits on, written so a failure reads like a sentence. */
async function anchors(org: string, sequenceId: string) {
  const rows = await listComments(org, sequenceId)
  return rows.map(c => `${c.body}@${c.cue_index}`)
}

/**
 * A sequence with notes on the given cues, inside a project of its own.
 *
 * Its own project every time: these tests renumber and delete, and sharing one
 * would let a failure in an earlier test show up as a mystery in a later one.
 */
async function sequenceWithNotes(org: string, at: number[]) {
  const project = await createProject(org, { name: 'Documental' })
  const sequence = await createSequence(org, {
    projectId: project.id,
    name: 'Bobina',
    fps: 25,
  })
  for (const cueIndex of at) {
    await createComment(org, {
      sequenceId: sequence.id,
      cueIndex,
      body: `n${cueIndex}`,
      authorId: 'user_a',
    })
  }
  return sequence
}

describe(
  'comment anchors against a live database',
  { skip: !HAS_DB && 'DATABASE_URL not set' },
  () => {
    it('pushes the notes below a split down one', async () => {
      const p = await sequenceWithNotes(orgA, [1, 2, 5])

      await updateSequence(
        orgA,
        p.id,
        { data: { cues: 'after the split' } },
        { anchorOps: [{ fromIndex: 2, delta: 1 }] },
      )

      assert.deepEqual(await anchors(orgA, p.id), ['n1@1', 'n2@3', 'n5@6'])
    })

    it('takes the deleted cue’s own notes with it', async () => {
      const p = await sequenceWithNotes(orgA, [1, 2, 3])

      await updateSequence(
        orgA,
        p.id,
        { data: {} },
        { anchorOps: [{ dropIndex: 2, fromIndex: 3, delta: -1 }] },
      )

      assert.deepEqual(await anchors(orgA, p.id), ['n1@1', 'n3@2'])
    })

    it('replays several edits in the order they were made', async () => {
      const p = await sequenceWithNotes(orgA, [4])

      // A split, then the undo of that split. Applied in order they cancel out;
      // collapsed or reordered, they would not.
      await updateSequence(
        orgA,
        p.id,
        { data: {} },
        {
          anchorOps: [
            { fromIndex: 2, delta: 1 },
            { fromIndex: 2, delta: -1 },
          ],
        },
      )

      assert.deepEqual(await anchors(orgA, p.id), ['n4@4'])
    })

    it('leaves another organisation’s notes where they are', async () => {
      const mine = await sequenceWithNotes(orgA, [3])
      const theirs = await sequenceWithNotes(orgB, [3])

      await updateSequence(orgA, mine.id, { data: {} }, { anchorOps: [{ fromIndex: 1, delta: 1 }] })

      assert.deepEqual(await anchors(orgA, mine.id), ['n3@4'])
      assert.deepEqual(await anchors(orgB, theirs.id), ['n3@3'])
    })

    /**
     * A lost save moves nothing.
     *
     * This one is carried by ordering rather than by the transaction — the
     * conflict is raised while writing the sequence, before the anchors are
     * touched at all. It is here because the guarantee is worth pinning
     * whichever mechanism happens to provide it; the test below is the one that
     * fails if the transaction goes away.
     */
    it('moves nothing when the save loses to somebody else', async () => {
      const p = await sequenceWithNotes(orgA, [1, 5])

      // Another editor gets there first, which bumps the version.
      await updateSequence(orgA, p.id, { data: { cues: 'theirs' } })

      await assert.rejects(
        updateSequence(
          orgA,
          p.id,
          { data: { cues: 'mine' } },
          { expectedVersion: p.version, anchorOps: [{ fromIndex: 1, delta: 1 }] },
        ),
        ConflictError,
      )

      assert.deepEqual(await anchors(orgA, p.id), ['n1@1', 'n5@5'])
    })

    /**
     * The reason for the transaction.
     *
     * A list of shifts is applied one statement at a time, after the cues have
     * already been written. Without a transaction, a list that fails halfway
     * leaves the sequence saved and the anchors half-moved — some notes following
     * the new numbering, some still on the old, and no way to tell which from
     * looking. Rolling back is what makes "the cues and their comments are saved
     * together, or not at all" true rather than usually true.
     *
     * The second shift overflows `integer`, which is a failure Postgres itself
     * raises mid-statement. `parseAnchorOps` would have rejected a jump that
     * size long before here, so this reaches past the route on purpose: the
     * guarantee has to hold for whatever gets this far, not only for the shifts
     * the editor happens to send today.
     */
    it('saves the cues and the anchors together, or neither', async () => {
      const p = await sequenceWithNotes(orgA, [1, 5])
      const OVERFLOW = 2_147_483_647

      await assert.rejects(
        updateSequence(
          orgA,
          p.id,
          { data: { cues: 'half a save' } },
          { anchorOps: [{ fromIndex: 1, delta: 1 }, { fromIndex: 1, delta: OVERFLOW }] },
        ),
      )

      // The first shift succeeded before the second one blew up. Both are gone.
      assert.deepEqual(await anchors(orgA, p.id), ['n1@1', 'n5@5'])

      // And so is the sequence write it was travelling with.
      const after = await query<{ data: unknown; version: number }>(
        'select data, version from sequences where org_id = $1 and id = $2',
        [orgA, p.id],
      )
      assert.deepEqual(after[0].data, {})
      assert.equal(after[0].version, p.version)
    })
  },
)
