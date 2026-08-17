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
  /** One hour of audio. */
  transcribeSeconds: 60 * 60,
  /** Roughly a 40-minute episode across a couple of languages. */
  translatedCues: 2_000,
} as const

/**
 * What a subscription buys.
 *
 * `monthlySubtitles` is enforced, not decoration: lib/entitlement.ts refuses
 * translation past it for the calendar month, and /pricing prints this same
 * figure. Raising it here raises the wall and the promise together, which is the
 * only way the two can be trusted to agree.
 */
export const PLANS: Plan[] = [
  {
    id: 'individual',
    name: 'Individual',
    price: 19,
    monthlySubtitles: 50000,
    seats: 1,
    stripePriceId: process.env.STRIPE_PRICE_INDIVIDUAL ?? '',
  },
  {
    id: 'team',
    name: 'Team',
    price: 49,
    monthlySubtitles: 200000,
    seats: 5,
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? '',
  },
]
