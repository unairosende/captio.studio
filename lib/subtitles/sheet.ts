import type { Subtitle } from './types.ts'

/**
 * One row per cue, one column per language.
 *
 * This is how a production company hands subtitles to a client: not six SRT
 * files, but a sheet somebody can read across — cue 412 in English beside cue
 * 412 in Spanish, with the timecode next to both. It is also what comes back
 * marked up, which is why the cue number is the first column.
 *
 * Everything is written as text, timecodes included. A spreadsheet left to
 * guess turns `00:00:01,000` into a time value and renders it back in whatever
 * the reader's locale prefers, and the file then no longer says what was
 * delivered.
 */

const HEADER = ['#', 'Start', 'End', 'Source']

export function sheetRows(
  subtitles: Subtitle[],
  translations: Record<string, Subtitle[]>,
  langs: string[] = Object.keys(translations),
): string[][] {
  // Indexed once per language rather than searched per cell: a feature at five
  // languages is a quarter of a million lookups otherwise.
  const byIndex = langs.map(lang => {
    const map = new Map<number, string>()
    for (const s of translations[lang] ?? []) map.set(s.index, s.text)
    return map
  })

  return [
    [...HEADER, ...langs],
    ...subtitles.map(s => [
      String(s.index),
      s.start,
      s.end,
      s.text,
      ...byIndex.map(m => m.get(s.index) ?? ''),
    ]),
  ]
}

/** RFC 4180: every field quoted, quotes doubled. Line breaks inside a cue survive. */
export function rowsToCsv(rows: string[][]): string {
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n'
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
//
// Written by hand rather than with a spreadsheet library. An .xlsx is a zip of
// five small XML files, and the alternative was a dependency an order of
// magnitude larger than this file, pulled into the bundle so that a sheet of
// strings could be written. Only what Excel, Numbers and LibreOffice need in
// order to open the file is emitted: no styles, no shared strings, no widths.

const escXml = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Control characters are not legal in XML at all, and one stray byte makes
    // the whole workbook refuse to open rather than one cell come out wrong.
    // Tab, newline and carriage return are the exceptions, and are kept.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** 0 → A, 25 → Z, 26 → AA. Spreadsheets number columns in bijective base 26. */
export function columnName(i: number): string {
  let n = i + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map(
          (cell, c) =>
            `<c r="${columnName(c)}${r + 1}" t="inlineStr">` +
            `<is><t xml:space="preserve">${escXml(cell)}</t></is></c>`,
        )
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`

const workbookXml = (sheetName: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="${escXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`

/** CRC-32 as the zip format specifies it. A wrong one and Excel refuses the file. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry {
  name: string
  data: Uint8Array
  crc: number
  offset: number
}

/**
 * A zip with every entry stored rather than deflated.
 *
 * A sheet of subtitles is a megabyte at most, and a file that opens is worth
 * more than a file that is small: storing means no encoder to carry and no
 * compressed stream to get subtly wrong, for a saving nobody downloading one
 * document would notice.
 *
 * Timestamps are fixed at the epoch the DOS format counts from, so exporting
 * the same work twice produces the same bytes.
 */
function zip(files: { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder()
  const entries: Entry[] = []

  let size = 0
  for (const f of files) {
    const data = encoder.encode(f.text)
    entries.push({ name: f.name, data, crc: crc32(data), offset: size })
    size += 30 + encoder.encode(f.name).length + data.length
  }
  const centralOffset = size
  for (const e of entries) size += 46 + encoder.encode(e.name).length
  size += 22

  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0

  const u16 = (v: number) => {
    view.setUint16(at, v, true)
    at += 2
  }
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true)
    at += 4
  }
  const bytes = (b: Uint8Array) => {
    out.set(b, at)
    at += b.length
  }

  for (const e of entries) {
    const name = encoder.encode(e.name)
    u32(0x04034b50)
    u16(20) // version needed to extract
    u16(0x0800) // the names are UTF-8
    u16(0) // stored
    u16(0) // time
    u16(0) // date
    u32(e.crc)
    u32(e.data.length)
    u32(e.data.length)
    u16(name.length)
    u16(0) // no extra field
    bytes(name)
    bytes(e.data)
  }

  for (const e of entries) {
    const name = encoder.encode(e.name)
    u32(0x02014b50)
    u16(20) // version made by
    u16(20) // version needed
    u16(0x0800)
    u16(0) // stored
    u16(0) // time
    u16(0) // date
    u32(e.crc)
    u32(e.data.length)
    u32(e.data.length)
    u16(name.length)
    u16(0) // extra
    u16(0) // comment
    u16(0) // disk number
    u16(0) // internal attributes
    u32(0) // external attributes
    u32(e.offset)
    bytes(name)
  }

  u32(0x06054b50)
  u16(0) // this disk
  u16(0) // disk with the central directory
  u16(entries.length)
  u16(entries.length)
  u32(size - 22 - centralOffset)
  u32(centralOffset)
  u16(0) // no comment

  return out
}

export function rowsToXlsx(rows: string[][], sheetName = 'Subtitles'): Uint8Array {
  return zip([
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: workbookXml(sheetName) },
    { name: 'xl/_rels/workbook.xml.rels', text: WORKBOOK_RELS },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml(rows) },
  ])
}
