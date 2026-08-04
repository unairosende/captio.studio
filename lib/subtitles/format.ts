import type { Subtitle, SubtitleFormat } from './types.ts'

/** Formats that hold their own timings, so "export all languages" writes one file per language. */
export const SUBTITLE_FORMATS: SubtitleFormat[] = ['srt', 'vtt', 'ass', 'ttml']

/** VTT and TTML use a dot before milliseconds; SRT uses a comma. */
const vttTime = (t: string) => t.replace(',', '.')

/** ASS wants `H:MM:SS.cc` — centiseconds, and no zero-padding on hours. */
function assTime(t: string): string {
  const [h, m, rest] = t.split(':')
  const [s, ms] = (rest ?? '').split(',')
  return `${+h}:${m}:${s}.${String(Math.round(+(ms ?? 0) / 10)).padStart(2, '0')}`
}

const escXml = (t: string) =>
  String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export interface FormatOptions {
  /** Used as the ASS `Title:` field. */
  title?: string
  /** Emitted as `xml:lang` in TTML, but only when it really looks like a language code. */
  lang?: string
}

export function formatSubs(
  subs: Subtitle[],
  fmt: SubtitleFormat,
  opts: FormatOptions = {},
): string {
  if (fmt === 'vtt') {
    return (
      'WEBVTT\n\n' +
      subs
        .map((s, i) => `${i + 1}\n${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text}`)
        .join('\n\n') +
      '\n'
    )
  }

  if (fmt === 'ass') {
    return (
      `[Script Info]\nTitle: ${opts.title ?? 'Subtitles'}\nScriptType: v4.00+\nWrapStyle: 0\n` +
      `ScaledBorderAndShadow: yes\nPlayResX: 1920\nPlayResY: 1080\n\n` +
      `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
      `Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,50,1\n\n` +
      `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
      subs
        .map(
          s =>
            `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,` +
            `${(s.text || '').replace(/\n/g, '\\N')}`,
        )
        .join('\n') +
      '\n'
    )
  }

  if (fmt === 'ttml') {
    // Tab names are free text, so only emit xml:lang when the value is a real code.
    const isCode = /^[a-z]{2}(-[A-Za-z]{2,4})?$/i.test(opts.lang ?? '')
    const attr = isCode ? ` xml:lang="${escXml(opts.lang!)}"` : ''
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml"${attr}>\n  <body>\n    <div>\n` +
      subs
        .map(
          s =>
            `      <p begin="${vttTime(s.start)}" end="${vttTime(s.end)}">` +
            `${escXml(s.text || '').replace(/\n/g, '<br/>')}</p>`,
        )
        .join('\n') +
      `\n    </div>\n  </body>\n</tt>\n`
    )
  }

  if (fmt === 'csv') {
    return (
      'Start Time,End Time,Text\n' +
      subs.map(s => `"${s.start}","${s.end}","${(s.text || '').replace(/"/g, '""')}"`).join('\n')
    )
  }

  if (fmt === 'txt') return subs.map(s => s.text).join('\n')

  return subs.map((s, i) => `${i + 1}\n${s.start} --> ${s.end}\n${s.text}`).join('\n\n') + '\n'
}

/**
 * Byte-order mark, where it helps.
 *
 * Excel misreads accented characters in UTF-8 CSV without it, and some SRT
 * players expect it. It breaks several VTT parsers, so it is never added there.
 */
export function bomFor(fmt: SubtitleFormat): string {
  return fmt === 'srt' || fmt === 'csv' ? '﻿' : ''
}

/** Filename-safe slug for a language tab name. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
}
