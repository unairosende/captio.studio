import { TranslationFormatError } from './prompt.ts'

/**
 * Ask about a whole batch, and halve it when the answer will not fit.
 *
 * `ask(from, to)` asks the model about that slice of the batch and returns one
 * entry per cue in it, or throws `TranslationFormatError` when the reply does
 * not name every cue. Anything else it throws is passed straight through.
 *
 * The whole batch gets two tries, because a miscount is sometimes a dice roll.
 * When it is a verdict — thirty cues answered with twenty-nine, twice — the
 * same prompt a third time would earn the same reply, so the batch is split
 * and each half asked once, down to a single cue if it comes to that. A cue on
 * its own cannot be merged with anything; and a pair the model insists on
 * joining ends up in different requests within a few halvings, leaving every
 * other cue translated in the company of its neighbours rather than one by one.
 *
 * Nothing is ever repaired by guessing: a reply that does not name every cue
 * is refused, however close it came. What changed is only that the refusal is
 * now the start of a smaller question rather than the end of the request — and
 * `budget` is where the questions stop. Spent, the last refusal is what the
 * caller hears, and it names the cue.
 */
export async function askInHalves<T>(
  size: number,
  ask: (from: number, to: number) => Promise<T[]>,
  budget: number,
): Promise<T[]> {
  let callsLeft = budget
  let lastRefusal: TranslationFormatError | null = null

  const run = async (from: number, to: number, attempts: number): Promise<T[]> => {
    for (let attempt = 0; attempt < attempts && callsLeft > 0; attempt++) {
      callsLeft--
      try {
        return await ask(from, to)
      } catch (err) {
        if (!(err instanceof TranslationFormatError)) throw err
        console.warn(`translation format rejected (${to - from} cues, attempt ${attempt + 1}):`, err.message)
        lastRefusal = err
      }
    }

    const width = to - from
    if (width < 2 || callsLeft < 2) {
      throw lastRefusal ?? new TranslationFormatError('the model would not answer this batch')
    }
    const mid = from + Math.ceil(width / 2)
    return [...(await run(from, mid, 1)), ...(await run(mid, to, 1))]
  }

  return run(0, size, 2)
}
