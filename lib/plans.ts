import type { Plan } from '@/types/subtitle'

/**
 * What a new organisation gets before paying anything.
 *
 * An amount, not a fortnight. Every AI call costs real money to a provider, so
 * a time-boxed trial is an open bar for whoever is busiest — and it punishes
 * the customer who happens to have a quiet fortnight. An amount only spends
 * money while somebody is genuinely evaluating.
 *
 * Sized as one real job: an episode transcribed and subtitled end to end, which
 * is the only demonstration that convinces a production company. Smaller and
 * they never reach the part that sells it.
 *
 * The two limits are independent on purpose. Running out of transcription must
 * not stop somebody translating an SRT they brought themselves; they are
 * separate promises and behave that way.
 *
 * There is no card up front, so this ceiling is also the entire defence against
 * an account opened purely to spend our provider credits.
 */
export const TRIAL = {
  /**
   * Thirty minutes of material, into as many languages as they like.
   *
   * Sized as one real job rather than a sample: half an hour is a short
   * documentary or two episodes of a series, which is the least that convinces
   * somebody the tool works on their own footage. It costs us about eleven
   * cents to give away, so the limit is here to stop an account opened purely
   * to spend our provider credit, not to ration the demonstration.
   */
  mediaMinutes: 30,
} as const

/**
 * What a subscription buys.
 *
 * `monthlyMediaMinutes` is enforced, not decoration: lib/entitlement.ts refuses
 * new AI work past it for the calendar month, and /pricing prints this same
 * figure. Raising it here raises the wall and the promise together, which is the
 * only way the two can be trusted to agree.
 *
 * Ten hours and fifty. Measured against what the work actually costs, both are
 * generous — a fully consumed Individual month runs about five dollars of
 * provider spend against twenty-nine euros — and that is deliberate. The
 * expensive part of subtitling is the hour a person spends on it, not the
 * tokens, so the plan is priced against the hour it saves.
 */
export const PLANS: Plan[] = [
  {
    id: 'individual',
    name: 'Individual',
    price: 29,
    monthlyMediaMinutes: 600,
    seats: 1,
    stripePriceId: process.env.STRIPE_PRICE_INDIVIDUAL ?? '',
  },
  {
    id: 'team',
    name: 'Studio',
    price: 99,
    monthlyMediaMinutes: 3_000,
    seats: 5,
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? '',
  },
]
