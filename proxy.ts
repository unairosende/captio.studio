import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Cheap gate in front of every request.
 *
 * This only checks that a session cookie is present. It does NOT verify it —
 * a cookie can be forged, expired, or belong to a user who was removed from
 * their organisation an hour ago. Verification belongs in app/(app)/layout.tsx,
 * which reads the session and re-checks membership against the database.
 *
 * The split is on purpose: middleware runs on every page request, so putting a
 * database round-trip here would tax the whole site to save a redirect. What it
 * buys is bouncing obvious signed-out traffic before it costs a render.
 */

// The recovery pages belong here, and the reason is worth writing down: somebody
// who has forgotten their password is, by definition, not signed in. Guarding
// them sends the one person who needs them to the login screen they cannot get
// past — a locked door with the key behind it.
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/pricing',
  '/forgot-password',
  '/reset-password',
  // A crawler has no session and never will. Left out, both are answered with a
  // redirect to the login page, which is a 307 where Google expects XML — the
  // site reads as having no sitemap at all, and nothing about that is visible
  // from inside the app.
  '/robots.txt',
  '/sitemap.xml',
  // A contract read only by people who already have an account is not a
  // contract anybody signs. These have to be reachable before signing up, and
  // by a lawyer who never will.
  '/terms',
  '/privacy',
  '/dpa',
  '/subprocessors',
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  // Auth endpoints must stay open or signing in becomes impossible.
  if (pathname.startsWith('/api/auth/')) return true
  // Stripe has no session cookie. Redirecting its POST to the login page would
  // mean subscriptions silently never get recorded — the request is
  // authenticated by its signature, which the route itself verifies.
  if (pathname.startsWith('/api/webhooks/')) return true
  // The same reasoning, missed the first time: the scheduler sends a bearer
  // token, not a session cookie. Redirecting it to the login page means the
  // sweeper never runs, and a sweeper that never runs is invisible — no error
  // anywhere, just orphaned audio and a bill that grows. The route checks
  // CRON_SECRET itself, and refuses outright when it is unset.
  if (pathname.startsWith('/api/cron/')) return true
  return false
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  if (!getSessionCookie(request)) {
    // An API caller gets an answer it can read. Redirecting a fetch to an HTML
    // login page makes the caller's res.json() throw, so a session that expired
    // mid-edit surfaces as "Unexpected token <" rather than "not signed in".
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const login = new URL('/login', request.url)
    // Remember where they were headed. An invitation link that drops someone on
    // a blank login screen and forgets the invitation is the first thing a new
    // customer would hit.
    login.searchParams.set('next', pathname + search)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
