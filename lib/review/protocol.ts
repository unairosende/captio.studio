/**
 * What the review view and the server agree on, with no imports on purpose:
 * the browser bundle reads this, and `lib/auth/actor.ts` reaches for `pg`.
 */

/** The header a client's browser sends with every request made through a link. */
export const REVIEW_TOKEN_HEADER = 'x-review-token'
