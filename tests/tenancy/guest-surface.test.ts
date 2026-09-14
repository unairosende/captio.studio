import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/**
 * What a client holding a review link can reach, pinned.
 *
 * A guest has no session. The only routes that will answer them are the ones
 * that authenticate through `requireActor`, plus the one where they say who
 * they are. That set is the whole attack surface a leaked link exposes, so it
 * is written down here and any change to it has to be made on purpose: adding
 * `requireActor` to the translate route would let a stranger spend the
 * organisation's minutes, and this is the test that would say so.
 */

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../app/api')

const GUEST_ROUTES = [
  'sequences/[id]/comments/route.ts',
  'sequences/[id]/comments/[commentId]/route.ts',
  'sequences/[id]/edits/route.ts',
  'sequences/[id]/versions/route.ts',
  'sequences/[id]/versions/[versionId]/route.ts',
]

/** The routes with no authentication of their own beyond the token in the URL. */
const PUBLIC_REVIEW_ROUTES = ['review/[token]/guest/route.ts']

function routes(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...routes(path))
    else if (name === 'route.ts') out.push(path)
  }
  return out
}

const all = routes(API_DIR)

describe('the surface a review link opens', () => {
  it('finds the routes to inspect', () => {
    assert.ok(all.length >= 15, `only found ${all.length} route files under app/api`)
  })

  it('lets a guest reach exactly the routes that were meant for them', () => {
    const withActor = all
      .filter(f => /\brequireActor\b/.test(readFileSync(f, 'utf8')))
      .map(f => relative(API_DIR, f))
      .sort()

    assert.deepEqual(withActor, [...GUEST_ROUTES].sort())
  })

  it('keeps the sessionless corner of the API to the one route that needs it', () => {
    const open = all
      .map(f => relative(API_DIR, f))
      .filter(f => f.startsWith('review/'))
      .sort()

    assert.deepEqual(open, [...PUBLIC_REVIEW_ROUTES].sort())
  })

  it('never lets a guest route fall back to a session check of its own', () => {
    // A route that calls both would take the session path when the header is
    // missing and skip the sequence check `requireActor` does for guests.
    for (const route of GUEST_ROUTES) {
      const src = readFileSync(join(API_DIR, route), 'utf8')
      assert.ok(!/\brequireOrgContext\b/.test(src), `${route} mixes requireActor with requireOrgContext`)
    }
  })
})
