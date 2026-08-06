import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { NoOrganizationError, UnauthorizedError, requireOrgContext } from '@/lib/auth/session'

/**
 * The gate for everything a customer can see.
 *
 * The middleware only checks that a session cookie exists, which is a guess.
 * This is the authoritative check: it resolves the session and re-reads the
 * membership, so a revoked cookie or a collaborator removed from the
 * organisation stops here rather than reaching a page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // `redirect()` works by throwing, so calling it inside the catch would have
  // the catch swallow its own control flow. Decide first, redirect after.
  let destination: string | null = null

  try {
    await requireOrgContext()
  } catch (err) {
    if (err instanceof UnauthorizedError) destination = '/login'
    else if (err instanceof NoOrganizationError) destination = '/onboarding'
    else throw err
  }

  if (destination) redirect(destination)

  return <>{children}</>
}
