import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { db, query } from '../../lib/db/client.ts'

/**
 * Nothing in `public` is reachable by the roles PostgREST authenticates as.
 *
 * `isolation.db.test.ts` proves the application scopes every query to one
 * organisation. That argument only matters for traffic that arrives through the
 * application: Supabase also serves `public` over HTTP, and there the caller is
 * `anon` or `authenticated` and no `org_id` filter of ours is in the path at
 * all. 0010 revoked those grants; this notices if they come back — a table
 * created outside these migrations inherits the default privileges of whoever
 * created it, and the schema looks entirely normal either way.
 *
 * Reads only, so it is safe against any database, production included:
 *   npm run test:db
 *
 * On a Postgres without those roles the cross join is empty and the test passes,
 * which is the correct answer — there is no PostgREST in front of it.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL)

after(async () => {
  if (!HAS_DB) return
  await db().end()
})

describe('the API roles against a live database', { skip: !HAS_DB && 'DATABASE_URL not set' }, () => {
  it('gives anon and authenticated no access to any table in public', async () => {
    const reachable = await query<{ grantee: string; table: string }>(
      `select r.rolname as grantee, c.relname as table
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
        where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_schema_privilege(r.rolname, n.oid, 'usage')
          and has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete')
        order by 1, 2`,
    )

    assert.deepEqual(
      reachable.map(row => `${row.grantee} → ${row.table}`),
      [],
    )
  })
})
