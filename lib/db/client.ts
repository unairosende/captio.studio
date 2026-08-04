import { Pool } from 'pg'

/**
 * Postgres access for the product tables.
 *
 * Deliberately the plain `pg` driver rather than supabase-js: the database is
 * rented, not married. Moving to Neon, RDS or a self-hosted box should be a
 * connection-string change, and nothing above this file should be able to tell
 * the difference.
 */

// Next reloads modules on every edit in dev; without this cache each reload
// leaks a pool and the connection limit is reached within minutes.
const globalForDb = globalThis as unknown as { __captioPool?: Pool }

export function db(): Pool {
  if (!globalForDb.__captioPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    globalForDb.__captioPool = new Pool({
      connectionString,
      // Fluid Compute reuses instances across concurrent requests, so a small
      // pool per instance is plenty and keeps well clear of Postgres limits.
      max: 5,
      idleTimeoutMillis: 30_000,
    })
  }
  return globalForDb.__captioPool
}

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query(text, params)
  return res.rows as T[]
}

export async function queryOne<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/** Run several statements atomically. Used where a write must not half-apply. */
export async function transaction<T>(fn: (run: typeof query) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    const run = async <R>(text: string, params: unknown[] = []): Promise<R[]> => {
      const res = await client.query(text, params)
      return res.rows as R[]
    }
    const out = await fn(run as typeof query)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Guard against the one mistake that leaks another customer's work: a query
 * reaching the database with an empty or undefined organisation.
 *
 * `org_id = ''` would match nothing today, but a future `IN` or `LIKE` clause
 * built from the same value would not be so harmless. Failing loudly here is
 * cheaper than finding out from a customer.
 */
export function requireOrg(orgId: string | null | undefined): string {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Missing organization id — refusing to run an unscoped query')
  }
  return orgId
}
