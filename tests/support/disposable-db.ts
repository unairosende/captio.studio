import { query } from '../../lib/db/client.ts'

/**
 * Refuse to run destructive tests against a database that has not been declared
 * disposable.
 *
 * The tests that call this create and delete rows. Pointed at production they
 * would do that to a customer's projects, and the only thing standing between
 * the two is a connection string in a file — which is precisely the thing that
 * gets pasted wrong.
 *
 * The permission lives in the database rather than in configuration, because
 * configuration is what gets confused. An unmarked database is treated as
 * production: no row, no permission.
 */
export async function requireDisposableDatabase(): Promise<void> {
  let name: string | undefined

  try {
    const rows = await query<{ name: string }>('select name from deployment_environment')
    name = rows[0]?.name
  } catch {
    throw new Error(
      'Refusing to run destructive tests: could not read deployment_environment. ' +
        'Run `npm run migrate` against this database first.',
    )
  }

  if (name !== 'development') {
    throw new Error(
      `Refusing to run destructive tests against a database marked "${name ?? 'nothing'}". ` +
        'These tests create and delete rows.\n' +
        'If this database really is disposable, mark it:\n' +
        "  insert into deployment_environment (name) values ('development');",
    )
  }
}
