'use client'

import { useRouter } from 'next/navigation'

import { useSubtitleStore } from '@/store/useSubtitleStore'
import { must } from '@/lib/api'
import { translateCues } from '@/lib/jobs/translate'
import { uploadMedia } from '@/lib/jobs/upload'
import { LANG_CODES } from '@/lib/providers'
import {
  type ParseHint,
  type SubtitleFormat,
  bomFor,
  finalSubs,
  formatSubs,
  parseContent,
  qcForMode,
  rowsToCsv,
  rowsToXlsx,
  sheetRows,
  slugify,
} from '@/lib/subtitles'
import type { Subtitle } from '@/types/subtitle'

/**
 * What the pipeline does, separated from how it looks.
 *
 * These are the sidebar's jobs — import, transcribe, translate, export — moved
 * out of the component that drew them, unchanged. The redesign rearranges the
 * controls into steps; the requests they make are the ones that were already
 * paid for and tested.
 */

/** A language as its two-letter code, for a tab or a status line. */
export function langCode(lang: string): string {
  return LANG_CODES[lang] ?? lang.slice(0, 2).toUpperCase()
}

/** The source, which may not have been named yet: then it is just "original". */
export function sourceLabel(srcLang: string): string {
  return srcLang === 'Auto-detect' ? 'original' : `${langCode(srcLang)} · original`
}

/**
 * Money has been spent — go and read how much is left.
 *
 * The allowance meter is a prop from a server component, so it is only ever
 * as fresh as the last page load. `router.refresh()` re-runs the page on the
 * server and leaves the editor's own state alone.
 */
export function useSpent() {
  const router = useRouter()
  return () => router.refresh()
}

/* ── Importar ───────────────────────────────────────────────────────────── */

export function useImport() {
  const loadSubtitles = useSubtitleStore(s => s.loadSubtitles)

  function fromFile(f: File, hint: ParseHint) {
    const r = new FileReader()
    r.onload = ev => loadSubtitles(parseContent(ev.target!.result as string, f.name, hint))
    r.readAsText(f)
  }

  function fromText(txt: string, hint: ParseHint) {
    const t = txt.trim()
    if (!t) return
    loadSubtitles(parseContent(t, 'pasted.srt', hint))
  }

  return { fromFile, fromText }
}

/* ── Traducir ───────────────────────────────────────────────────────────── */

export function useTranslate() {
  const spent = useSpent()

  async function start(lang: string) {
    const { subtitles, srcLang, outputMode, sequenceId, mediaId, glossary, setTranslateJob, setTranslation } =
      useSubtitleStore.getState()
    if (!lang || !subtitles.length) return

    setTranslateJob({ running: true, progress: 0, message: 'Traduciendo…', error: null })

    let result: Subtitle[]
    try {
      result = await translateCues(
        { cues: subtitles, lang, sourceLang: srcLang, outputMode, sequenceId, mediaId, glossary },
        p => setTranslateJob(
          p.waiting
            ? { message: `Traduciendo… ${p.done}/${p.total} — siguiente lote en ${p.waiting} s` }
            : { progress: Math.round(p.done / p.total * 100), message: `Traduciendo… ${p.done}/${p.total}` },
        ),
      )
    } catch (e: unknown) {
      setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
      // The batches before this one were paid for.
      spent()
      return
    }

    setTranslation(lang, result)
    setTranslateJob({ running: false, progress: 100, message: `Listo — ${result.length} cues`, error: null })
    spent()
  }

  return { start }
}

/* ── Transcribir ────────────────────────────────────────────────────────── */

export function useTranscribe() {
  const spent = useSpent()

  /**
   * What is loaded in the viewer, sent up and brought back as cues.
   *
   * Nothing to choose: the file the timeline was handed is the one that goes,
   * already playing and already decoded — its waveform and length are the
   * ones the row records. A sequence opened from the bucket has no file here
   * and is asked for one.
   */
  async function start(language: string) {
    const { outputMode, playback, setTranscribeJob, setMediaId, loadSubtitles } = useSubtitleStore.getState()
    const file = playback?.file
    if (!file) return
    setTranscribeJob({ running: true, progress: 30, message: 'Preparando el archivo…', error: null })

    try {
      const mediaId = await uploadMedia(
        file,
        { contentType: playback.contentType, durationSeconds: playback.durationSeconds, peaks: playback.peaks },
        {
          onStage: setTranscribeJob,
          // Remembered rather than used and forgotten: the save attaches it to the
          // sequence, and a translation names it as the material it belongs to.
          onGrant: setMediaId,
        },
      )

      setTranscribeJob({ message: 'Transcribiendo…', progress: 75 })
      const data = await must('/api/transcribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mediaId,
          language: language !== 'auto' ? language : undefined,
          outputMode,
        }),
      })

      setTranscribeJob({ progress: 100 })
      // Already cues, already timecoded: the server cuts them from the word
      // timings so the boundaries obey the same rules as the quality checks.
      const segs = (data.segments as Subtitle[] | undefined) ?? []
      if (!segs.length) throw new Error('No se encontró voz — puede que el archivo esté en silencio')
      loadSubtitles(segs)
      setTranscribeJob({ running: false, message: `${segs.length} cues transcritos`, error: null })
    } catch (e: unknown) {
      setTranscribeJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
    } finally {
      spent()
    }
  }

  return { start }
}

/* ── Exportar ───────────────────────────────────────────────────────────── */

function download(filename: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  // The object URL pins the blob in memory until the document goes away, and
  // a session of exports on a feature-length project is real memory.
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
}

export function useExport() {
  function tab(fmt: SubtitleFormat) {
    const { subtitles, translations, activeTab, outputMode } = useSubtitleStore.getState()
    const cues = activeTab === 'source' ? subtitles : translations[activeTab]
    if (!cues?.length) return
    const subs = finalSubs(cues, outputMode, qcForMode(outputMode))
    // The BOM matters: Excel misreads accented characters in UTF-8 CSV without
    // one, and some players expect it in SRT.
    const content = bomFor(fmt) + formatSubs(subs, fmt, { lang: activeTab, title: activeTab })
    download(`${slugify(activeTab)}.${fmt}`, new Blob([content], { type: 'text/plain;charset=utf-8' }))
  }

  /**
   * Every language in one sheet — the file a client is actually sent.
   *
   * Built from the translations as they are, keyed to the source cue list,
   * which is the thing every language does share.
   */
  function all(fmt: 'xlsx' | 'csv') {
    const { subtitles, translations, sequenceName } = useSubtitleStore.getState()
    const langs = Object.keys(translations)
    if (!subtitles.length || !langs.length) return

    const rows = sheetRows(subtitles, translations, langs)
    const name = `${slugify(sequenceName || 'subtitles')}_all_languages`

    if (fmt === 'csv') {
      download(`${name}.csv`, new Blob([bomFor('csv') + rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' }))
      return
    }
    download(
      `${name}.xlsx`,
      new Blob([rowsToXlsx(rows) as unknown as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )
  }

  return { tab, all }
}
