import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { transcriptDocx, transcriptParagraphs, transcriptText } from '../../lib/subtitles/transcript.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * The transcript a client reads.
 *
 * The cue list is cut for the screen; read as text it is a sentence broken
 * every few words. What is checked here is the joining back: where a paragraph
 * starts, and that the pieces of one sentence become one sentence again.
 */

const cue = (index: number, start: string, end: string, text: string): Subtitle =>
  ({ index, start: `00:00:${start},000`, end: `00:00:${end},000`, text })

describe('transcriptParagraphs', () => {
  it('runs cues that follow each other into one paragraph, lines and all', () => {
    const p = transcriptParagraphs([
      cue(1, '01', '03', 'Llegamos al pueblo\ncuando ya era de noche'),
      cue(2, '03', '05', 'y no quedaba nadie.'),
    ])
    assert.deepEqual(p, [{ at: '00:00:01', text: 'Llegamos al pueblo cuando ya era de noche y no quedaba nadie.' }])
  })

  it('starts a paragraph after a pause, stamped with when it starts', () => {
    const p = transcriptParagraphs([
      cue(1, '01', '03', 'Primero.'),
      cue(2, '06', '08', 'Después.'),
    ])
    assert.deepEqual(p.map(x => x.at), ['00:00:01', '00:00:06'])
  })

  it('starts one for each speaker a dash introduces, even inside a cue', () => {
    const p = transcriptParagraphs([cue(1, '01', '03', '- ¿Vienes?\n- Ahora no.')])
    assert.deepEqual(p.map(x => x.text), ['- ¿Vienes?', '- Ahora no.'])
  })

  it('mends a sentence the subtitler split with dots', () => {
    const p = transcriptParagraphs([
      cue(1, '01', '03', 'Yo creo que...'),
      cue(2, '03', '05', '...nadie lo vio venir.'),
    ])
    assert.equal(p[0].text, 'Yo creo que nadie lo vio venir.')
  })

  it('breaks a long run at a full stop rather than letting it go on for pages', () => {
    const long = 'Una frase larga que se repite. '.repeat(25).trim()
    const p = transcriptParagraphs([cue(1, '01', '03', long), cue(2, '03', '05', 'Y sigue.')])
    assert.equal(p.length, 2)
  })

  it('skips cues with nothing in them', () => {
    assert.deepEqual(transcriptParagraphs([cue(1, '01', '03', ' \n ')]), [])
  })
})

describe('transcriptText', () => {
  it('puts the heading first and each paragraph under its time', () => {
    const text = transcriptText([cue(1, '01', '03', 'Hola.')], { title: 'Episodio 1', detail: 'ES · original' })
    assert.equal(text, 'Episodio 1\nES · original\n\n[00:00:01]\nHola.\n')
  })
})

describe('transcriptDocx', () => {
  it('is a zip holding the document, with the text escaped', () => {
    const bytes = transcriptDocx([cue(1, '01', '03', 'Tom & Jerry <en directo>')], { title: 'Episodio 1' })
    const raw = new TextDecoder().decode(bytes)
    assert.equal(raw.slice(0, 2), 'PK')
    assert.ok(raw.includes('word/document.xml'))
    assert.ok(raw.includes('Tom &amp; Jerry &lt;en directo&gt;'))
  })
})
