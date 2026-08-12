import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { columnName, crc32, rowsToCsv, rowsToXlsx, sheetRows } from '../../lib/subtitles/sheet.ts'
import type { Subtitle } from '../../types/subtitle.ts'

/**
 * The delivery sheet.
 *
 * This file is the one that leaves the building: it goes to a client, comes
 * back marked up, and settles arguments about what was delivered. Two ways of
 * being wrong are silent — a language column shifted by a row, and a workbook
 * Excel refuses to open because the checksums do not match the bytes.
 */

const cue = (index: number, text: string): Subtitle => ({
  index,
  start: `00:00:0${index},000`,
  end: `00:00:0${index + 1},000`,
  text,
})

const source = [cue(1, 'one'), cue(2, 'two'), cue(3, 'three')]

describe('sheetRows', () => {
  it('puts every language in its own column, aligned by cue number', () => {
    const rows = sheetRows(source, {
      Spanish: [cue(1, 'uno'), cue(2, 'dos'), cue(3, 'tres')],
      French: [cue(1, 'un'), cue(2, 'deux'), cue(3, 'trois')],
    })

    assert.deepEqual(rows[0], ['#', 'Start', 'End', 'Source', 'Spanish', 'French'])
    assert.deepEqual(rows[2], ['2', '00:00:02,000', '00:00:03,000', 'two', 'dos', 'deux'])
  })

  it('leaves a gap rather than sliding the rest of a language up', () => {
    // A translation missing cue 2: the row stays empty, because closing the gap
    // would attach every later line to the wrong timecode.
    const rows = sheetRows(source, { Spanish: [cue(1, 'uno'), cue(3, 'tres')] })

    assert.equal(rows[2][4], '')
    assert.equal(rows[3][4], 'tres')
  })
})

describe('rowsToCsv', () => {
  it('quotes every field and doubles the quotes inside one', () => {
    const csv = rowsToCsv([['plain', 'say "hi"', 'two\nlines']])

    assert.equal(csv, '"plain","say ""hi""","two\nlines"\r\n')
  })
})

describe('columnName', () => {
  it('counts in bijective base 26, as spreadsheets do', () => {
    assert.equal(columnName(0), 'A')
    assert.equal(columnName(25), 'Z')
    assert.equal(columnName(26), 'AA')
    assert.equal(columnName(27), 'AB')
    assert.equal(columnName(51), 'AZ')
    assert.equal(columnName(52), 'BA')
  })
})

/** Walk the local file headers of a stored zip. Enough to check our own output. */
function readZip(bytes: Uint8Array): Map<string, { data: Uint8Array; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, { data: Uint8Array; crc: number }>()

  let at = 0
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    const nameLen = view.getUint16(at + 26, true)
    const extraLen = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen))
    const start = at + 30 + nameLen + extraLen
    files.set(name, { data: bytes.subarray(start, start + size), crc })
    at = start + size
  }
  return files
}

describe('rowsToXlsx', () => {
  const xlsx = rowsToXlsx(sheetRows(source, { Spanish: [cue(1, 'Nautilus & Co')] }))
  const files = readZip(xlsx)

  it('is a zip carrying the parts a spreadsheet looks for', () => {
    assert.deepEqual(
      [...files.keys()],
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/worksheets/sheet1.xml',
      ],
    )
    // The end-of-central-directory record, which is how a reader finds anything.
    const view = new DataView(xlsx.buffer, xlsx.byteOffset, xlsx.byteLength)
    assert.equal(view.getUint32(xlsx.length - 22, true), 0x06054b50)
    assert.equal(view.getUint16(xlsx.length - 12, true), 5, 'five entries recorded')
  })

  it('records a checksum that matches the bytes it stored', () => {
    // Wrong here and Excel reports a corrupt file, having read it perfectly.
    for (const [name, file] of files) {
      assert.equal(crc32(file.data), file.crc, `${name} checksum`)
    }
  })

  it('writes the cells as text, with the markup escaped', () => {
    const sheet = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')!.data)

    assert.match(sheet, /t="inlineStr"/)
    assert.match(sheet, /Nautilus &amp; Co/)
    // The timecode has to survive as written; a spreadsheet that reads it as a
    // number hands it back in the reader's own locale.
    assert.match(sheet, /<t xml:space="preserve">00:00:01,000<\/t>/)
  })

  it('drops the bytes that would make the workbook unopenable', () => {
    const withControl = rowsToXlsx([['before\u0007after']])
    const sheet = new TextDecoder().decode(
      readZip(withControl).get('xl/worksheets/sheet1.xml')!.data,
    )

    assert.match(sheet, /beforeafter/)
  })

  it('produces the same bytes for the same work', () => {
    const again = rowsToXlsx(sheetRows(source, { Spanish: [cue(1, 'Nautilus & Co')] }))

    assert.deepEqual([...again], [...xlsx])
  })
})
