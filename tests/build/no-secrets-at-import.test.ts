import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/**
 * Importing a module must never require a secret.
 *
 * `next build` evaluates module scope while collecting route config, on a
 * machine that has no database and no API keys. A module that reads a variable
 * at import time and throws when it is missing does not fail at runtime — it
 * fails the build, and the only place that shows up is a broken deploy.
 *
 * That is exactly how the auth route took production down: lib/auth/server.ts
 * called db() at module scope, db() threw on a missing DATABASE_URL, and the
 * build died collecting config for /api/auth/[...all].
 *
 * Each module is imported in a child process with the environment stripped, so
 * no earlier import in this test run can mask the problem.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

const MODULES = [
  'lib/db/client.ts',
  'lib/db/index.ts',
  'lib/auth/server.ts',
  'lib/email/send.ts',
]

const STRIPPED = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
]

describe('modules import without configuration', () => {
  for (const mod of MODULES) {
    it(`imports ${mod} with no environment`, () => {
      const env: NodeJS.ProcessEnv = { ...process.env }
      for (const key of STRIPPED) delete env[key]

      // Any throw during import surfaces as a non-zero exit here.
      assert.doesNotThrow(
        () =>
          execFileSync(
            process.execPath,
            ['--input-type=module', '-e', `await import('./${mod}')`],
            { cwd: ROOT, env, stdio: 'pipe' },
          ),
        `${mod} cannot be imported without configuration — this breaks next build`,
      )
    })
  }
})
