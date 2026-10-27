import { escXml, zip } from './sheet.ts'
import { srtToSec } from './timecode.ts'
import type { Subtitle } from './types.ts'

/**
 * A transcript to read rather than to play: the cues run back together into
 * the prose they were cut from.
 *
 * Subtitles are sliced for the screen — two lines, a few seconds, a sentence
 * broken wherever the reading speed demanded — and the plain-text export that
 * writes one cue per line hands that slicing to a reader as if it were the
 * text. Here a pause in the speech or a change of speaker starts a paragraph,
 * and each paragraph carries the time it begins at, so whoever reads it can
 * find the line in the picture.
 */

/** A silence this long between two cues is a new thought: a new paragraph. */
const PAUSE_SECONDS = 2
/** Past this many characters a paragraph ends at its next full stop rather than running on. */
const LONG_PARAGRAPH = 600

export interface Paragraph {
  /** Where it starts, `HH:MM:SS`. */
  at: string
  text: string
}

/** A line that opens with a dash is somebody else speaking. */
const TURN = /^[-–—]/
const ENDS_SENTENCE = /[.!?…]["'»”)]*$/
const TRAILING_DOTS = /\s*(\.\.\.|…)$/
const LEADING_DOTS = /^(\.\.\.|…)\s*/

/**
 * Two pieces of one sentence. A cue that ends in "…" and a next one that
 * opens with it are one sentence the subtitler split on screen; in prose the
 * dots go.
 */
function join(a: string, b: string): string {
  return TRAILING_DOTS.test(a) && LEADING_DOTS.test(b)
    ? `${a.replace(TRAILING_DOTS, '')} ${b.replace(LEADING_DOTS, '')}`
    : `${a} ${b}`
}

export function transcriptParagraphs(cues: Subtitle[]): Paragraph[] {
  const out: Paragraph[] = []
  let lastEnd = -Infinity

  for (const cue of cues) {
    const lines = cue.text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (!lines.length) continue

    const pause = srtToSec(cue.start) - lastEnd >= PAUSE_SECONDS
    lastEnd = srtToSec(cue.end)

    lines.forEach((line, i) => {
      const current = out[out.length - 1]
      const fresh =
        !current ||
        TURN.test(line) ||
        (i === 0 && pause) ||
        (current.text.length >= LONG_PARAGRAPH && ENDS_SENTENCE.test(current.text))
      if (fresh) out.push({ at: cue.start.slice(0, 8), text: line })
      else current.text = join(current.text, line)
    })
  }
  return out
}

export interface TranscriptHeading {
  title: string
  /** The line under the title: which language, which track. */
  detail?: string
}

/** The transcript as plain text: heading, then each paragraph under its time. */
export function transcriptText(cues: Subtitle[], heading: TranscriptHeading): string {
  const head = [heading.title, heading.detail].filter(Boolean).join('\n')
  const body = transcriptParagraphs(cues).map(p => `[${p.at}]\n${p.text}`)
  return [head, ...body].join('\n\n') + '\n'
}

/**
 * The same as a Word document, for the client who will print it, mark it up
 * or paste from it. Written by hand like the sheet next door: three small
 * files in a zip are all Word, Pages and Google Docs need, and direct
 * formatting on the runs saves carrying a stylesheet.
 */
export function transcriptDocx(cues: Subtitle[], heading: TranscriptHeading): Uint8Array {
  const run = (text: string, props: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${props}</w:rPr>` +
    `<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`
  const para = (after: number, runs: string) =>
    `<w:p><w:pPr><w:spacing w:after="${after}" w:line="300" w:lineRule="auto"/></w:pPr>${runs}</w:p>`

  const body = [
    para(heading.detail ? 60 : 360, run(heading.title, '<w:b/><w:sz w:val="36"/>')),
    heading.detail ? para(360, run(heading.detail, '<w:color w:val="767676"/><w:sz w:val="20"/>')) : '',
    ...transcriptParagraphs(cues).map(p =>
      para(200, run(p.at, '<w:color w:val="767676"/><w:sz w:val="18"/>') + '<w:r><w:br/></w:r>' + run(p.text, '<w:sz w:val="22"/>')),
    ),
  ].join('')

  return zip([
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        body +
        // A4 with 2.5 cm margins: the page a client in Europe prints on.
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>',
    },
  ])
}
