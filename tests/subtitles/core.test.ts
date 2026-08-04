import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_QC,
  bomFor,
  charStatus,
  cueCps,
  formatSubs,
  looksLikeTimecode,
  midTimecode,
  normalizeTc,
  parseCsv,
  parseCsvRows,
  parseContent,
  parseSrt,
  qcIssues,
  qcStatus,
  qcTrack,
  renumber,
  secToSrt,
  srtToSec,
  tcToMs,
  type Subtitle,
} from '../../lib/subtitles/index.ts'

const cue = (over: Partial<Subtitle> = {}): Subtitle => ({
  index: 1,
  start: '00:00:00,000',
  end: '00:00:02,000',
  text: 'Hola',
  ...over,
})

describe('timecode', () => {
  it('round-trips SRT timecodes', () => {
    assert.equal(tcToMs('00:00:01,500'), 1500)
    assert.equal(tcToMs('01:02:03,004'), 3723004)
    assert.equal(srtToSec('00:00:01,500'), 1.5)
    assert.equal(srtToSec(''), 0)
    assert.equal(srtToSec('not a timecode'), 0)
  })

  it('snaps to the frame grid instead of emitting arbitrary milliseconds', () => {
    // 1.01s is mid-frame at 25fps; the nearest boundary is 1.00s.
    assert.equal(secToSrt(1.01), '00:00:01,000')
    // 1.03s rounds up to frame 26 → 1.04s.
    assert.equal(secToSrt(1.03), '00:00:01,040')
    // Every emitted value must land on a whole frame.
    for (const sec of [0.017, 0.99, 3.333, 12.5]) {
      const ms = tcToMs(secToSrt(sec))
      assert.equal(ms % 40, 0, `${sec}s produced ${ms}ms, not a 25fps boundary`)
    }
  })

  it('honours a non-25 frame rate', () => {
    // At 30fps a frame is 33.33ms, so 1.02s snaps to frame 31 → 1033ms.
    assert.equal(secToSrt(1.02, 30), '00:00:01,033')
  })

  it('reads a 2-digit sub-second part as frames, not milliseconds', () => {
    // The bug this guards: HH:MM:SS:FF from an NLE export. Frame 12 at 25fps is
    // 480ms; reading it as 12ms would shift the whole track.
    assert.equal(normalizeTc('00:00:01:12'), '00:00:01,480')
    assert.equal(normalizeTc('00:00:01,480'), '00:00:01,480')
    assert.equal(normalizeTc('00:00:01.480'), '00:00:01,480')
  })

  it('expands MM:SS timecodes to a full hour field', () => {
    assert.equal(normalizeTc('01:30,500'), '00:01:30,500')
  })

  it('leaves unrecognised input alone beyond the decimal mark', () => {
    assert.equal(normalizeTc('garbage'), 'garbage')
    assert.equal(normalizeTc(''), '')
    assert.equal(normalizeTc(null), '')
  })

  it('recognises timecode-shaped strings', () => {
    assert.equal(looksLikeTimecode('00:00:01,480'), true)
    assert.equal(looksLikeTimecode('00:00:01:12'), true)
    assert.equal(looksLikeTimecode('Start Time'), false)
    assert.equal(looksLikeTimecode(undefined), false)
  })

  it('finds the midpoint between two cues', () => {
    assert.equal(midTimecode('00:00:00,000', '00:00:02,000'), '00:00:01,000')
  })
})

describe('parsing', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
Primera línea

2
00:00:04,000 --> 00:00:06,000
<i>Segunda</i>
con dos líneas
`

  it('parses SRT, strips tags and keeps internal newlines', () => {
    const subs = parseSrt(srt)
    assert.equal(subs.length, 2)
    assert.equal(subs[0].text, 'Primera línea')
    assert.equal(subs[1].text, 'Segunda\ncon dos líneas')
    assert.equal(subs[1].start, '00:00:04,000')
  })

  it('drops blocks with no text', () => {
    assert.equal(parseSrt('1\n00:00:01,000 --> 00:00:03,000\n\n').length, 0)
  })

  it('keeps commas and quotes inside CSV cells', () => {
    const rows = parseCsvRows('a,"b,c","say ""hi"""\n')
    assert.deepEqual(rows, [['a', 'b,c', 'say "hi"']])
  })

  it('parses CSV with a header and frame-based timecodes', () => {
    const csv = 'Start Time,End Time,Text\n"00:00:01:12","00:00:03:00","Hola, qué tal"\n'
    const subs = parseCsv(csv)
    assert.equal(subs.length, 1)
    assert.equal(subs[0].start, '00:00:01,480')
    assert.equal(subs[0].end, '00:00:03,000')
    assert.equal(subs[0].text, 'Hola, qué tal')
  })

  it('treats a headerless CSV as data', () => {
    const subs = parseCsv('"00:00:01,000","00:00:02,000","Uno"\n')
    assert.equal(subs.length, 1)
    assert.equal(subs[0].index, 1)
  })

  it('routes by extension when no hint is given', () => {
    assert.equal(parseContent('línea uno\nlínea dos', 'guion.txt').length, 2)
    assert.equal(parseContent('1\n00:00:01,000 --> 00:00:02,000\nHola', 'x.srt').length, 1)
  })

  it('renumbers from one', () => {
    const out = renumber([cue({ index: 7 }), cue({ index: 9 })])
    assert.deepEqual(out.map(s => s.index), [1, 2])
  })
})

describe('formatting', () => {
  const subs: Subtitle[] = [
    cue({ index: 1, start: '00:00:01,000', end: '00:00:03,500', text: 'Uno\ndos' }),
  ]

  it('writes SRT with comma milliseconds', () => {
    assert.match(formatSubs(subs, 'srt'), /1\n00:00:01,000 --> 00:00:03,500\nUno\ndos/)
  })

  it('writes VTT with a dot and a header', () => {
    const out = formatSubs(subs, 'vtt')
    assert.match(out, /^WEBVTT\n/)
    assert.match(out, /00:00:01\.000 --> 00:00:03\.500/)
  })

  it('writes ASS with centiseconds and escaped newlines', () => {
    const out = formatSubs(subs, 'ass', { title: 'Proyecto' })
    assert.match(out, /Title: Proyecto/)
    assert.match(out, /Dialogue: 0,0:00:01\.00,0:00:03\.50,Default,,0,0,0,,Uno\\Ndos/)
  })

  it('emits xml:lang in TTML only for real language codes', () => {
    assert.match(formatSubs(subs, 'ttml', { lang: 'es' }), /xml:lang="es"/)
    assert.match(formatSubs(subs, 'ttml', { lang: 'es-ES' }), /xml:lang="es-ES"/)
    // A free-text tab name is not a language code.
    assert.doesNotMatch(formatSubs(subs, 'ttml', { lang: 'Castellano rev.2' }), /xml:lang/)
  })

  it('escapes XML and converts newlines to <br/> in TTML', () => {
    const out = formatSubs([cue({ text: 'a < b & "c"' })], 'ttml')
    assert.match(out, /a &lt; b &amp; &quot;c&quot;/)
    assert.match(formatSubs(subs, 'ttml'), /Uno<br\/>dos/)
  })

  it('doubles quotes in CSV', () => {
    const out = formatSubs([cue({ text: 'say "hi"' })], 'csv')
    assert.match(out, /"say ""hi"""/)
  })

  it('adds a BOM only where it helps', () => {
    assert.equal(bomFor('srt'), '﻿')
    assert.equal(bomFor('csv'), '﻿')
    // A BOM breaks several VTT parsers.
    assert.equal(bomFor('vtt'), '')
    assert.equal(bomFor('ttml'), '')
  })
})

describe('quality checks', () => {
  const cfg = { ...DEFAULT_QC, maxChars: 42 }

  it('flags reading speed above the error threshold', () => {
    // 60 chars in 2s = 30 cps, over cpsError (21).
    const s = cue({ text: 'x'.repeat(60), start: '00:00:00,000', end: '00:00:02,000' })
    assert.equal(Math.round(cueCps(s)!), 30)
    assert.equal(qcStatus(s, null, cfg), 'error')
  })

  it('warns between the warn and error thresholds', () => {
    // 40 chars in 2s = 20 cps: over cpsWarn (17), under cpsError (21).
    const s = cue({ text: 'x'.repeat(40), start: '00:00:00,000', end: '00:00:02,000' })
    const issues = qcIssues(s, null, cfg)
    assert.equal(issues.some(i => i.level === 'error'), false)
    assert.equal(issues.some(i => /Reading speed/.test(i.msg)), true)
  })

  it('rejects an end time at or before the start', () => {
    const s = cue({ start: '00:00:02,000', end: '00:00:01,000' })
    assert.equal(qcStatus(s, null, cfg), 'error')
    assert.equal(cueCps(s), null)
  })

  it('detects overlaps and short gaps against the previous cue', () => {
    const prev = cue({ index: 1, start: '00:00:00,000', end: '00:00:02,000' })

    const overlapping = cue({ index: 2, start: '00:00:01,500', end: '00:00:03,000' })
    assert.equal(qcStatus(overlapping, prev, cfg), 'error')

    // 40ms gap is under minGap (80ms) but not an overlap.
    const tight = cue({ index: 2, start: '00:00:02,040', end: '00:00:04,000' })
    const issues = qcIssues(tight, prev, cfg)
    assert.equal(issues.some(i => i.level === 'error'), false)
    assert.equal(issues.some(i => /Gap/.test(i.msg)), true)
  })

  it('caps lines at two no matter what the config says', () => {
    const three = cue({ text: 'a\nb\nc', end: '00:00:05,000' })
    const permissive = { ...cfg, maxLines: 5 }
    assert.equal(charStatus(three.text, permissive), 'error')
    assert.equal(qcStatus(three, null, permissive), 'error')
  })

  it('flags long lines and warns near the limit', () => {
    assert.equal(charStatus('x'.repeat(43), cfg), 'error')
    assert.equal(charStatus('x'.repeat(38), cfg), 'warn')
    assert.equal(charStatus('x'.repeat(10), cfg), 'ok')
  })

  it('passes a clean cue', () => {
    const s = cue({ text: 'Una línea corta', start: '00:00:00,000', end: '00:00:03,000' })
    assert.deepEqual(qcIssues(s, null, cfg), [])
    assert.equal(qcStatus(s, null, cfg), 'ok')
  })

  it('checks a whole track in one pass, pairing each cue with its predecessor', () => {
    const track = [
      cue({ index: 1, start: '00:00:00,000', end: '00:00:02,000', text: 'Uno' }),
      cue({ index: 2, start: '00:00:01,000', end: '00:00:03,000', text: 'Dos' }), // overlaps #1
      cue({ index: 3, start: '00:00:04,000', end: '00:00:06,000', text: 'Tres' }),
    ]
    const result = qcTrack(track, cfg)
    assert.equal(result.get(1)!.status, 'ok')
    assert.equal(result.get(2)!.status, 'error')
    assert.equal(result.get(3)!.status, 'ok')
  })
})
