import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/server'

/**
 * Every auth endpoint — sign-in, sign-up, callbacks, organisation and
 * invitation routes — is served from this one catch-all.
 */
export const { GET, POST } = toNextJsHandler(auth)
