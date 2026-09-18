import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeSequence, shortLang } from '../../lib/lang.ts'

describe('a sequence in one line', () => {
  it('names the languages by their codes', () => {
    assert.equal(shortLang('Spanish'), 'ES')
    assert.equal(shortLang('pt-br'), 'pt-br')
    assert.equal(shortLang('ca'), 'CA')
    assert.equal(
      describeSequence({ cue_count: 1234, source_lang: 'Spanish', target_langs: ['English', 'French'] }),
      '1234 cues · ES → EN · FR',
    )
  })

  it('leaves the source out while it is still to be detected', () => {
    assert.equal(describeSequence({ cue_count: 8, source_lang: 'Auto-detect', target_langs: ['English'] }), '8 cues · EN')
    assert.equal(describeSequence({ cue_count: 8, source_lang: null, target_langs: [] }), '8 cues')
    assert.equal(describeSequence({ cue_count: 8, source_lang: 'Spanish', target_langs: [] }), '8 cues · ES')
  })
})
