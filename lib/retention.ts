/**
 * How long a cancelled organisation's data survives, and the notice before it goes.
 *
 * Ninety days from when paid access ended, which is generous on purpose: a
 * production company that cancels between jobs and comes back a quarter later
 * still finds its work, and the storage of a handful of dormant accounts is
 * cheaper than the support call that says "we deleted everything the week after
 * you left". Data minimisation still applies — this is a ceiling, not a promise
 * to keep anything a day longer — it just sits where a real customer's rhythm,
 * not the strictest possible reading, put it.
 *
 * The notice is a hard floor, not a countdown from the cancellation: the sweep
 * refuses to erase until the warning has actually been sent and this many days
 * have passed since, so a fortnight of failed cron runs cannot compress the
 * warning and the deletion into the same day. See lib/db/retention.ts.
 *
 * Kept as plain constants, with no database or environment behind them, so the
 * email template and the copy can read the same numbers the sweep enforces.
 */
export const RETENTION_DAYS = 90
export const RETENTION_NOTICE_DAYS = 7
