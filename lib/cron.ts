import { timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

/**
 * Only the scheduler may run a cron route.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set.
 * With no secret configured the answer is no — a route that deletes things must
 * fail closed, and an unauthenticated deleter reachable from the internet is
 * worse than a sweep that never runs.
 *
 * One copy, shared by every cron: two of these is two chances for one to drift
 * into a `==` that leaks its answer through timing, and this is the whole guard
 * standing between the public internet and a route that erases customer data.
 */
export function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization')
  if (!secret || !header) return false

  const given = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
