import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_QC,
  bomFor,
  charStatus,
  compileGlossary,
  cueCps,
  glossaryIssues,
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
  repeatedWords,
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

describe('glossary consistency', () => {
  const check = (text: string, entries: { term?: string; translation?: string }[]) =>
    glossaryIssues(text, compileGlossary(entries)).map(i => i.msg)

  it('catches a term written in the wrong case', () => {
    // The case that started this: the file says "Reserva de la Familia"
    // everywhere and one cue says "reserva de la familia". Both read fine on
    // their own line, and the client sees it immediately.
    const msgs = check('el reserva de la familia es el que guardamos.', [
      { term: 'Reserva de la Familia' },
    ])
    assert.equal(msgs.length, 1)
    assert.match(msgs[0], /written as "reserva de la familia" — should be "Reserva de la Familia"/)
  })

  it('says nothing when the term is written as agreed', () => {
    assert.deepEqual(check('El Reserva de la Familia es el que guardamos.', [
      { term: 'Reserva de la Familia' },
    ]), [])
  })

  it('checks the agreed translation, not the source term', () => {
    assert.deepEqual(check('La hacienda lo aprobó.', [
      { term: 'Tax Office', translation: 'Hacienda' },
    ]), ['Glossary term written as "hacienda" — should be "Hacienda"'])
    // The English side is not what the translation is measured against.
    assert.deepEqual(check('The tax office approved it.', [
      { term: 'Tax Office', translation: 'Hacienda' },
    ]), [])
  })

  it('leaves a lower-case term alone when it opens a sentence', () => {
    // "terroir" is a common noun and the glossary agrees it stays lower case,
    // but a sentence still starts with a capital. That is grammar, not drift.
    assert.deepEqual(check('Terroir is what we sell.', [{ term: 'terroir' }]), [])
    assert.deepEqual(check('Es un vino. Terroir, dicen.', [{ term: 'terroir' }]), [])
    // Mid-sentence it is a real inconsistency.
    assert.deepEqual(check('We sell Terroir here.', [{ term: 'terroir' }]),
      ['Glossary term written as "Terroir" — should be "terroir"'])
  })

  it('matches whole words only', () => {
    assert.deepEqual(check('Solo vino, sin sol.', [{ term: 'Sol' }]),
      ['Glossary term written as "sol" — should be "Sol"'])
  })

  it('finds a term that begins with a letter outside ASCII', () => {
    // `\bÑoño\b` does not match: JavaScript's \b is defined on ASCII and
    // finds no boundary in front of "Ñ".
    assert.deepEqual(check('Pregunta por ñoño, el de siempre.', [{ term: 'Ñoño' }]),
      ['Glossary term written as "ñoño" — should be "Ñoño"'])
  })

  it('survives a term containing regex punctuation', () => {
    assert.deepEqual(check('Compramos c++ ayer.', [{ term: 'C++' }]),
      ['Glossary term written as "c++" — should be "C++"'])
  })

  it('reports one term once however often the cue repeats it', () => {
    assert.deepEqual(check('hacienda dijo que hacienda decide.', [{ term: 'Hacienda' }]).length, 1)
  })

  it('reuses one compiled glossary across a whole track', () => {
    // Compiled once per track and matched against every cue. A regex with the
    // global flag that carried its lastIndex between cues would find the term
    // in the first and miss it in the next.
    const terms = compileGlossary([{ term: 'Hacienda' }])
    for (const text of ['dice hacienda uno', 'dice hacienda dos', 'dice hacienda tres']) {
      assert.equal(glossaryIssues(text, terms).length, 1, text)
    }
  })

  it('sees a term the layout broke across two lines', () => {
    // Found on screen, not here: "Reserva de la Familia" is twenty-one
    // characters, so reflow wraps it mid-term and the raw text carries a
    // newline where the glossary has a space. Matching that text found
    // nothing — correct or not — on exactly the long names this is for.
    assert.deepEqual(check('el reserva de la\nfamilia es el que guardamos.', [
      { term: 'Reserva de la Familia' },
    ]), ['Glossary term written as "reserva de la familia" — should be "Reserva de la Familia"'])

    // And stays quiet when the wrapped term is written correctly.
    assert.deepEqual(check('el Reserva de la\nFamilia es el que guardamos.', [
      { term: 'Reserva de la Familia' },
    ]), [])
  })

  it('is off unless a glossary is supplied', () => {
    assert.deepEqual(check('reserva de la familia', []), [])
  })
})

describe('proper-name casing', () => {
  const track = (texts: string[]): Subtitle[] =>
    texts.map((text, i) => cue({
      index: i + 1,
      start: `00:00:${String(i * 3).padStart(2, '0')},000`,
      end: `00:00:${String(i * 3 + 2).padStart(2, '0')},000`,
      text,
    }))

  const casing = (texts: string[], glossary: { term?: string }[] = []): string[] =>
    [...qcTrack(track(texts), DEFAULT_QC, glossary)]
      .flatMap(([n, v]) => v.issues.filter(i => /is written/.test(i.msg)).map(i => `#${n} ${i.msg}`))

  it('reports a name the track spells one way once and another way the rest of the time', () => {
    assert.deepEqual(
      casing([
        'Probamos el Reserva de la Familia.',
        'Ese Reserva de la Familia es del 98.',
        'Nadie toca el Reserva de la Familia.',
        'Sacamos el reserva de la familia\nsolo en fiestas.',
      ]),
      ['#4 "reserva de la familia" is written "Reserva de la Familia" elsewhere'],
    )
  })

  it('leaves an ordinary noun alone when a proper name happens to contain it', () => {
    // The case that rules out comparing word by word. Both are correct: one is
    // part of a name, the other is the noun. Word-level matching calls it a
    // fault, and a film about a family winery is full of it.
    assert.deepEqual(
      casing([
        'La viña lleva cuatro generaciones\nen la familia.',
        'el Reserva de la Familia\nes el que guardamos.',
        'Toda la familia trabaja aquí.',
      ]),
      [],
    )
  })

  it('does not treat a capital that opens a sentence as evidence', () => {
    assert.deepEqual(
      casing([
        'Terroir es una palabra francesa.',
        'Hablamos del terroir todo el rato.',
        'Ese terroir no se compra.',
      ]),
      [],
    )
  })

  it('says nothing when the two spellings are used equally often', () => {
    assert.deepEqual(
      casing([
        'Aquí el Terroir manda.',
        'Sin ese Terroir no hay vino.',
        'Nuestro terroir es único.',
        'Ese terroir cambia cada año.',
      ]),
      [],
    )
  })

  it('leaves a term the glossary already governs to the glossary check', () => {
    const texts = [
      'Probamos el Reserva de la Familia.',
      'Ese Reserva de la Familia es del 98.',
      'Sacamos el reserva de la familia hoy.',
    ]
    assert.equal(casing(texts).length, 1)
    assert.deepEqual(casing(texts, [{ term: 'Reserva de la Familia' }]), [])
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

  it('measures how much of a cue repeats the text of the one before it', () => {
    // The real shape of the bug: a long subtitle divided in two, with the tail
    // written into both halves instead of moved into the second.
    assert.equal(
      repeatedWords(
        'a nivel casi mundial, a nivel varietal, a nivel de',
        'a nivel varietal, a nivel de producciones',
      ),
      6,
    )

    // The run is not the tail of the first cue: what follows it was duplicated
    // too, and then half-corrected — "De Ruar" here, "Terroir" there. Comparing
    // the two ends would see a mismatch and report nothing.
    assert.equal(
      repeatedWords(
        'Lo metemos en una botella, lo embotellamos y es nuestro De Ruar en una botella.',
        'lo embotellamos y es nuestro Terroir en una botella.',
      ),
      5,
    )

    // Case and punctuation differ across the split more often than not.
    assert.equal(repeatedWords('siempre la calidad, que es lo', 'Que es lo que nos ha movido'), 3)

    // Dialogue repeats itself constantly. Only a repeat the next cue *opens*
    // with is a split gone wrong.
    assert.equal(repeatedWords('Yo creo que, yo creo que ahora', 'estamos en un buen momento'), 0)
    assert.equal(repeatedWords('Cuando llega septiembre, todo el pueblo', 'se pone a vendimiar, todo el pueblo'), 0)

    // Two words is chance, not a bad split.
    assert.equal(repeatedWords('y es nuestro vino', 'nuestro vino de la casa'), 0)

    assert.equal(repeatedWords('Una frase entera', 'Otra distinta del todo'), 0)
  })

  it('warns when a cue opens with text already in the previous one', () => {
    const prev = cue({ index: 18, text: 'para el consumo propio, pero ha terminado' })
    const next = cue({
      index: 19,
      text: 'pero ha terminado siendo otra cosa',
      start: '00:00:02,500',
      end: '00:00:05,000',
    })

    const issues = qcIssues(next, prev, cfg)
    // A guess about content never blocks the work.
    assert.equal(issues.some(i => i.level === 'error'), false)
    assert.equal(issues.some(i => /Opens with 3 words already in cue #18/.test(i.msg)), true)
    assert.equal(qcStatus(next, prev, cfg), 'warn')
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
