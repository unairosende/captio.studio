/**
 * What a provider call cost us, in dollars.
 *
 * Prices live in the environment rather than in this file because they change
 * when a provider changes them, and that is not an occasion for a deploy.
 *
 * A model missing from the table is recorded as zero rather than estimated. An
 * invented price is indistinguishable from a real one once it is a row in
 * `usage_events`, and the column exists to be trusted by whatever enforces a
 * quota against it.
 */

interface ModelPrice {
  /** Dollars per million input tokens. Language models. */
  inPerMTok?: number
  /** Dollars per million output tokens. */
  outPerMTok?: number
  /** Dollars per hour of audio. Transcription, which is billed by duration. */
  perHour?: number
}

/**
 * Read at call time, never at module scope.
 *
 * `next build` evaluates module scope on a machine that has no secrets set — see
 * the note on the pool in lib/db/client.ts. Malformed JSON must not throw here
 * either: this runs on the way to a metering write, and metering is never worth
 * failing a translation the provider has already billed us for.
 */
function priceTable(): Record<string, ModelPrice> {
  const raw = process.env.PRICES
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ModelPrice>) : {}
  } catch {
    console.error('PRICES is not valid JSON — cost will be recorded as zero')
    return {}
  }
}

const SECONDS_PER_HOUR = 3_600
const PER_MILLION = 1_000_000

/**
 * Units into dollars, in whichever denomination the model is priced in.
 *
 * The denominations do not convert into one another and no model carries both:
 * `unitsIn` is seconds of audio against a per-hour price, and tokens against a
 * per-million-token one. Which of the two a number is depends entirely on the
 * model that produced it, which is why the model has to be named here.
 *
 * Rounded to the six decimals `usage_events.cost_usd` stores, so the value that
 * lands in the row is the value that came out of here.
 */
export function costUsd(
  model: string | null | undefined,
  units: { unitsIn?: number; unitsOut?: number },
): number {
  const price = model ? priceTable()[model] : undefined
  if (!price) return 0

  const unitsIn = Number(units.unitsIn) || 0
  const unitsOut = Number(units.unitsOut) || 0

  let total = 0
  if (typeof price.perHour === 'number') total += (unitsIn / SECONDS_PER_HOUR) * price.perHour
  if (typeof price.inPerMTok === 'number') total += (unitsIn / PER_MILLION) * price.inPerMTok
  if (typeof price.outPerMTok === 'number') total += (unitsOut / PER_MILLION) * price.outPerMTok

  return Number.isFinite(total) ? Math.round(total * PER_MILLION) / PER_MILLION : 0
}
