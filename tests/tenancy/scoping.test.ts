import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { requireOrg } from '../../lib/db/client.ts'

/**
 * Isolation between customers is enforced in application code, not in RLS, so
 * a single forgotten `where org_id = $1` is enough to show one productora
 * another's work. That is the highest-severity bug this product can ship.
 *
 * These checks read the SQL out of lib/db and assert the invariant statically.
 * They need no database, so there is no excuse for them not to run on every
 * change. They do not replace integration tests against a live Postgres — they
 * catch the mistake earlier and for free.
 */

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../lib/db')

/** Tables holding customer data. Anything here must never be queried unscoped. */
const TENANT_TABLES = [
  'projects',
  'project_versions',
  'media',
  'comments',
  'usage_events',
  'subscriptions',
]

interface Statement {
  file: string
  sql: string
}

function collectStatements(): Statement[] {
  const out: Statement[] = []
  for (const file of readdirSync(DB_DIR).filter(f => f.endsWith('.ts') && f !== 'client.ts')) {
    const src = readFileSync(join(DB_DIR, file), 'utf8')
    for (const m of src.matchAll(/`([^`]*)`/g)) {
      const sql = m[1].replace(/\s+/g, ' ').trim()
      if (/^(select|insert|update|delete)\b/i.test(sql)) out.push({ file, sql })
    }
  }
  return out
}

const statements = collectStatements()

const touchesTenantTable = (sql: string) =>
  TENANT_TABLES.some(t => new RegExp(`\\b(from|into|update|join)\\s+${t}\\b`, 'i').test(sql))

describe('tenant isolation', () => {
  it('finds the SQL to inspect', () => {
    // A refactor that moves SQL elsewhere must not make these checks vacuously
    // pass — an empty set would otherwise be reported as success.
    assert.ok(statements.length >= 15, `only found ${statements.length} statements in lib/db`)
  })

  it('scopes every read and mutation by org_id', () => {
    const offenders = statements
      .filter(s => /^(select|update|delete)\b/i.test(s.sql))
      .filter(s => touchesTenantTable(s.sql))
      .filter(s => !/org_id\s*=\s*\$\d/.test(s.sql))
      .map(s => `${s.file}: ${s.sql.slice(0, 90)}`)

    assert.deepEqual(offenders, [], 'statements missing an org_id filter')
  })

  it('writes org_id on every insert', () => {
    const offenders = statements
      .filter(s => /^insert\b/i.test(s.sql))
      .filter(s => touchesTenantTable(s.sql))
      .filter(s => !/insert\s+into\s+\w+\s*\([^)]*\borg_id\b/i.test(s.sql))
      .map(s => `${s.file}: ${s.sql.slice(0, 90)}`)

    assert.deepEqual(offenders, [], 'inserts that do not set org_id')
  })

  it('never interpolates values into SQL', () => {
    // Only identifiers assembled from a fixed allow-list may be interpolated.
    // A `${}` holding user input is SQL injection, and injection defeats every
    // org_id filter above it.
    const ALLOWED = ['${SUMMARY_COLS}', "${sets.join(', ')}", '${guard}', '${params.length}']
    const offenders = statements
      .flatMap(s => [...s.sql.matchAll(/\$\{[^}]*\}/g)].map(m => ({ file: s.file, expr: m[0] })))
      .filter(x => !ALLOWED.includes(x.expr))
      .map(x => `${x.file}: ${x.expr}`)

    assert.deepEqual(offenders, [], 'unexpected interpolation in SQL')
  })

  it('parameterises with placeholders rather than literals', () => {
    const suspicious = statements
      .filter(s => touchesTenantTable(s.sql))
      .filter(s => /=\s*'[^']*'/.test(s.sql))
      .map(s => `${s.file}: ${s.sql.slice(0, 90)}`)

    assert.deepEqual(suspicious, [], 'string literals compared in SQL')
  })
})

describe('requireOrg', () => {
  it('refuses an absent organisation', () => {
    for (const bad of [undefined, null, '']) {
      assert.throws(() => requireOrg(bad as string), /Missing organization id/)
    }
  })

  it('passes a real id through unchanged', () => {
    assert.equal(requireOrg('org_abc123'), 'org_abc123')
  })
})
