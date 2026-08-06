import { getMigrations } from 'better-auth/db/migration'

import { authOptions } from '../lib/auth/server.ts'

/**
 * Print the SQL Better Auth needs for the current configuration.
 *
 *   node --env-file=.env.local db/auth-schema.ts > db/migrations/000N_auth.sql
 *
 * Better Auth can apply its own migrations, but then the database would have
 * two things migrating it and no single ordered history. Generating the SQL and
 * checking it in keeps `db/migrations/` the only source of truth, so a fresh
 * database is reproducible from the repository alone.
 *
 * Re-run this after changing plugins or adding fields: it reports what is
 * missing, and the diff goes into a new numbered migration — never into one
 * that has already been applied.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.')
    process.exit(1)
  }

  const { toBeCreated, toBeAdded, compileMigrations } = await getMigrations(authOptions)

  if (!toBeCreated.length && !toBeAdded.length) {
    console.error('Schema is already up to date; nothing to generate.')
    return
  }

  for (const t of toBeCreated) console.error(`new table:  ${t.table}`)
  for (const t of toBeAdded) {
    console.error(`new fields: ${t.table} (${Object.keys(t.fields).join(', ')})`)
  }

  // Notes go to stderr so stdout stays pure SQL and can be redirected.
  process.stdout.write(await compileMigrations())
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
