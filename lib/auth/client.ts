'use client'

import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Browser-side auth.
 *
 * No baseURL is set on purpose: the client talks to the same origin it was
 * served from, so localhost, preview deployments and production all work
 * without a per-environment constant that someone forgets to change.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
} = authClient
