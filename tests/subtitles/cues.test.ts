import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cuesFromWords, type TimedWord } from '../../lib/subtitles/cues.ts'
import { DEFAULT_QC } from '../../lib/subtitles/types.ts'

/**
 * Cue boundaries are the difference between a transcript and subtitles.
 *
 * Everything downstream assumes them: the quality checks, the character
 * budget, the translation batches. Getting them wrong is not a visible crash —
 * it is a file that looks fine until somebody tries to read it on screen.
 */

/** Words at a natural pace, laid end to end from `from`. */
function speak(sentence: string, from: number, speakerId?: string): TimedWord[] {
  let t = from
  return sentence.split(' ').map(text => {
    const start = t
    t += 0.3
    return { text, start, end: t, speakerId }
  })
}

/** SRT back to seconds, spelled out so the test does not lean on the code under test. */
function seconds(srt: string): number {
  const [h, m, rest] = srt.split(':')
  const [s, ms] = rest.split(',')
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

describe('cues from word timings', () => {
  it('returns nothing for nothing', () => {
    assert.deepEqual(cuesFromWords([]), [])
    assert.deepEqual(cuesFromWords([{ text: '  ', start: 0, end: 1 }]), [])
  })

  it('always breaks when the speaker changes', () => {
    // The reason diarisation was asked for. Two voices in one cue is wrong
    // however short the pause between them.
    const words = [
      ...speak('are you ready', 0, 'speaker_0'),
      ...speak('yes go ahead', 0.9, 'speaker_1'),
    ]

    const cues = cuesFromWords(words)

    assert.equal(cues.length, 2)
    assert.equal(cues[0].text, 'are you ready')
    assert.equal(cues[1].text, 'yes go ahead')
  })

  it('breaks on a silence a viewer would notice', () => {
    const words = [...speak('first thought', 0), ...speak('second thought', 5)]

    assert.equal(cuesFromWords(words).length, 2)
  })

  it('does not break on the rhythm of ordinary speech', () => {
    assert.equal(cuesFromWords(speak('one two three four five', 0)).length, 1)
  })

  it('breaks after a finished sentence', () => {
    const words = [
      ...speak('this first sentence is long enough to stand alone.', 0),
      ...speak('and here is the next one', 15.1),
    ]

    const cues = cuesFromWords(words)

    assert.ok(cues.length >= 2)
    assert.match(cues[0].text, /alone\.$/)
  })

  it('keeps a short answer with what follows it', () => {
    // "Yes." on its own would appear and vanish before it could be read.
    const words = [...speak('Yes.', 0), ...speak('I was there that morning', 0.35)]

    const cues = cuesFromWords(words)

    assert.equal(cues.length, 1)
    assert.match(cues[0].text, /^Yes\./)
  })

  it('never exceeds the character budget', () => {
    const words = speak(
      'the quick brown fox jumps over the lazy dog and then continues running ' +
        'across the field towards the river where it finally stops to drink',
      0,
    )

    for (const cue of cuesFromWords(words)) {
      for (const line of cue.text.split('\n')) {
        assert.ok(
          line.length <= DEFAULT_QC.maxChars,
          `line of ${line.length} chars exceeds ${DEFAULT_QC.maxChars}: ${line}`,
        )
      }
      assert.ok(cue.text.split('\n').length <= DEFAULT_QC.maxLines)
    }
  })

  it('never exceeds the maximum duration', () => {
    // Slow, evenly spaced speech with no pause long enough to break on: the
    // duration ceiling is the only thing that can end a cue here.
    const words: TimedWord[] = Array.from({ length: 40 }, (_, i) => ({
      text: 'word',
      start: i * 0.5,
      end: i * 0.5 + 0.4,
    }))

    for (const cue of cuesFromWords(words)) {
      const length = seconds(cue.end) - seconds(cue.start)
      assert.ok(length <= DEFAULT_QC.maxDur + 0.5, `cue lasts ${length}s`)
    }
  })

  it('holds a flash-past cue on screen a little longer', () => {
    const cues = cuesFromWords([{ text: 'Hi', start: 0, end: 0.2 }])

    assert.equal(cues.length, 1)
    assert.ok(seconds(cues[0].end) >= DEFAULT_QC.minDur - 0.05)
  })

  it('will not hold one cue over the start of the next', () => {
    // Overlapping cues get stacked or dropped by players, which is worse than
    // a cue that is only briefly on screen.
    const cues = cuesFromWords([
      { text: 'Hi', start: 0, end: 0.2, speakerId: 'a' },
      { text: 'Bye', start: 0.3, end: 0.5, speakerId: 'b' },
    ])

    assert.equal(cues.length, 2)
    assert.ok(
      seconds(cues[0].end) <= seconds(cues[1].start),
      `${cues[0].end} runs into ${cues[1].start}`,
    )
  })

  it('numbers cues from one, in order', () => {
    const words = [...speak('one two', 0), ...speak('three four', 5), ...speak('five six', 10)]

    assert.deepEqual(
      cuesFromWords(words).map(c => c.index),
      [1, 2, 3],
    )
  })

  it('places a word longer than the budget rather than looping on it', () => {
    const monster = 'x'.repeat(DEFAULT_QC.maxChars * 3)
    const cues = cuesFromWords([{ text: monster, start: 0, end: 1 }])

    assert.equal(cues.length, 1)
    assert.equal(cues[0].text, monster)
  })
})
