/**
 * How long the links we email stay good for.
 *
 * In one place because these numbers get said twice: once to Better Auth, which
 * enforces them, and once in prose to the person holding the link. Those two
 * drifting apart is the kind of bug nobody reports — the screen promises seven
 * days, the token dies on the fourth, and the invited colleague quietly assumes
 * they did something wrong.
 *
 * No imports on purpose: the configuration reads this on the server, and the
 * team panel reads it in the browser.
 */

const HOUR = 60 * 60
const DAY = 24 * HOUR

/** Long enough to survive a weekend and a holiday; short enough to expire. */
export const INVITATION_EXPIRY_DAYS = 7
export const INVITATION_EXPIRY_SECONDS = INVITATION_EXPIRY_DAYS * DAY

/**
 * Deliberately short. A reset link is a way into somebody's account sitting in
 * an inbox, and inboxes get read on shared laptops and forwarded by mistake.
 */
export const RESET_EXPIRY_HOURS = 1
export const RESET_EXPIRY_SECONDS = RESET_EXPIRY_HOURS * HOUR
