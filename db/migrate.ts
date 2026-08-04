import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * Apply pending SQL migrations, in filename order, exactly once each.
 *
 *   node --env-file=.env.local db/migrate.ts
 *
 * Deliberately not a migration framework: a table of applied filenames and a
 * transaction per file is the whole job. Each file runs inside BEGIN/COMMIT, so
 * a failure half-way leaves the schema untouched rather than partly migrated.
 *
 * Uses a direct Client rather than the pooled connection: DDL under a
 * transaction pooler can land on a different backend between statements.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Run with: node --env-file=.env.local db/migrate.ts')
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    await client.query(`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const applied = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        r => r.name,
      ),
    )

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()

    const pending = files.filter(f => !applied.has(f))
    if (!pending.length) {
      console.log(`Nothing to apply — ${files.length} migration(s) already in place.`)
      return
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      process.stdout.write(`Applying ${file} … `)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('COMMIT')
        console.log('ok')
      } catch (err) {
        await client.query('ROLLBACK')
        console.log('failed')
        throw err
      }
    }

    console.log(`Applied ${pending.length} migration(s).`)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
