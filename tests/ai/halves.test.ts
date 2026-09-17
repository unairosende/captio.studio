import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { askInHalves } from '../../lib/ai/halves.ts'
import { TranslationFormatError } from '../../lib/ai/prompt.ts'

/**
 * A model that merges cues `a` and `b` whenever both are in the request, and
 * answers every other slice correctly. Records what it was asked.
 */
function merging(a: number, b: number) {
  const asked: [number, number][] = []
  const ask = async (from: number, to: number): Promise<string[]> => {
    asked.push([from, to])
    if (from <= a && b < to) {
      throw new TranslationFormatError(`model returned nothing for subtitle ${b} — it merged it into a neighbour`)
    }
    return Array.from({ length: to - from }, (_, i) => `t${from + i}`)
  }
  return { ask, asked }
}

const expected = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe('askInHalves', () => {
  it('asks once when the whole batch comes back right', async () => {
    const { ask, asked } = merging(-1, -1)
    assert.deepEqual(await askInHalves(30, ask, 16), expected(30))
    assert.deepEqual(asked, [[0, 30]])
  })

  it('tries the whole batch twice before splitting it', async () => {
    // A miscount is sometimes a dice roll, and a second roll of the whole
    // batch is cheaper than any number of halves.
    let calls = 0
    const ask = async (from: number, to: number) => {
      calls++
      if (calls === 1) throw new TranslationFormatError('unlucky')
      return Array.from({ length: to - from }, (_, i) => `t${from + i}`)
    }
    assert.deepEqual(await askInHalves(30, ask, 16), expected(30))
    assert.equal(calls, 2)
  })

  it('separates a pair the model insists on merging, and keeps the order', async () => {
    // The bug this exists for: thirty cues answered with twenty-nine, twice.
    // Cues 20 and 21 end up in different requests within a few halvings and
    // every other cue is still translated beside its neighbours.
    const { ask, asked } = merging(20, 21)
    assert.deepEqual(await askInHalves(30, ask, 16), expected(30))
    assert.deepEqual(asked.slice(0, 2), [[0, 30], [0, 30]])
    assert.ok(asked.length <= 16, `should stay within budget, made ${asked.length} calls`)
  })

  it('isolates the worst-placed pair within the budget the route grants', async () => {
    // The pair sits at the very end, so every halving keeps it on the deeper
    // side: two tries on the whole, then one per half, down to a single cue.
    const { ask, asked } = merging(28, 29)
    assert.deepEqual(await askInHalves(30, ask, 16), expected(30))
    assert.ok(asked.length <= 16, `made ${asked.length} calls`)
  })

  it('stops at the budget and names the cue in the refusal it gives up with', async () => {
    const { ask, asked } = merging(28, 29)
    await assert.rejects(
      () => askInHalves(30, ask, 4),
      (e: Error) => e instanceof TranslationFormatError && /subtitle 29/.test(e.message),
    )
    assert.ok(asked.length <= 4, `made ${asked.length} calls`)
  })

  it('never splits a single cue, and never guesses for it', async () => {
    const ask = async () => {
      throw new TranslationFormatError('model returned subtitle 7 twice — it split it')
    }
    await assert.rejects(() => askInHalves(1, ask, 16), TranslationFormatError)
  })

  it('passes any other failure straight through', async () => {
    // A provider outage is not a reason to ask smaller questions.
    let calls = 0
    const ask = async () => {
      calls++
      throw new Error('HTTP 503')
    }
    await assert.rejects(() => askInHalves(30, ask, 16), /HTTP 503/)
    assert.equal(calls, 1)
  })
})
