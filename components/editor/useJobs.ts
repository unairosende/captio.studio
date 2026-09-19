'use client'

import { useRouter } from 'next/navigation'

import { useSubtitleStore } from '@/store/useSubtitleStore'
import { api, must } from '@/lib/api'
import { decodeAudio, mediaType } from '@/lib/audio/decode'
import { packPeaks } from '@/lib/audio/peaks'
import { LANG_CODES, TRANSLATION_BATCH, TRANSLATION_PAUSE_MS } from '@/lib/providers'
import { MAX_UPLOAD_BYTES } from '@/lib/upload'
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

    const BATCH = TRANSLATION_BATCH
    const PAUSE = TRANSLATION_PAUSE_MS
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const result: Subtitle[] = []

    setTranslateJob({ running: true, progress: 0, message: 'Traduciendo…', error: null })

    for (let i = 0; i < subtitles.length; i += BATCH) {
      if (i > 0) {
        for (let c = Math.round(PAUSE / 1000); c > 0; c--) {
          setTranslateJob({ message: `Traduciendo… ${i}/${subtitles.length} — siguiente lote en ${c} s` })
          await sleep(1000)
        }
      }
      const batch = subtitles.slice(i, i + BATCH)

      try {
        // Cues, not prose. The server composes the prompt, so a subscription
        // cannot be turned into a general-purpose model.
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'translate',
            cues: batch.map(s => s.text),
            // The anchor each cue travels under, so a reply short by one can
            // say which one is missing.
            cueNumbers: batch.map(s => s.index),
            targetLang: lang,
            sourceLang: srcLang,
            outputMode,
            // Which material this belongs to. Plans are sold in minutes, so a
            // translation that names neither an upload nor a saved sequence
            // has nothing the server can charge — and is refused.
            sequenceId,
            mediaId,
            // Sent with every batch: each request is its own conversation.
            glossary,
          }),
        })
        if (data.error) throw new Error(data.error)
        // No falling back to the source text. A cue left in the original
        // language but presented as translated ships as finished work.
        const parsed = data.translations as string[]
        batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
        setTranslateJob({
          progress: Math.round((i + batch.length) / subtitles.length * 100),
          message: `Traduciendo… ${Math.min(i + BATCH, subtitles.length)}/${subtitles.length}`,
        })
      } catch (e: unknown) {
        setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        // The batches before this one were paid for.
        spent()
        return
      }
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

  async function start(file: File, language: string) {
    const { outputMode, setTranscribeJob, setMediaId, setPlayback, loadSubtitles } = useSubtitleStore.getState()
    setTranscribeJob({ running: true, progress: 30, message: 'Leyendo el archivo…', error: null })

    try {
      const contentType = mediaType(file)
      const isVideo = contentType.startsWith('video/')

      // Decoded once, here, for everything that needs it: the waveform the
      // timeline draws now and every later visit draws from the row, the length
      // the row records, and — only when the file is too big to send — the audio
      // that goes up in its place.
      const decoded = await decodeAudio(file)
      const peaks = decoded ? packPeaks(decoded.peaks) : []

      // The picture, straight from disk, before a byte has gone up. The upload
      // is for next time; this time the file is right here.
      setPlayback({
        url: URL.createObjectURL(file),
        contentType,
        filename: file.name,
        durationSeconds: decoded?.duration ?? null,
        peaks,
      })

      // Whole, so it plays back from the bucket later — unless it is a master
      // that would not fit, in which case the audio alone goes, as it always
      // did, and playback stays local to this session.
      let upload: Blob = file
      let uploadName = file.name
      let uploadType = contentType
      if (file.size > MAX_UPLOAD_BYTES) {
        if (!decoded) throw new Error('El archivo pasa de 1 GB y no se pudo extraer el audio para subirlo')
        setTranscribeJob({ message: 'Demasiado grande para subir entero — extrayendo el audio…', progress: 40 })
        upload = new Blob([audioBufferToWav(decoded.buffer)], { type: 'audio/wav' })
        uploadName = file.name.replace(/\.[^.]+$/, '.wav')
        uploadType = 'audio/wav'
      }

      setTranscribeJob({ message: isVideo && upload === file ? 'Subiendo el vídeo…' : 'Subiendo el audio…', progress: 55 })

      const grantData = await must('/api/media', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          filename: uploadName,
          contentType: uploadType,
          bytes: upload.size,
          durationSeconds: decoded?.duration,
          peaks: decoded ? peaks : undefined,
        }),
      })

      // Remembered rather than used and forgotten: the save attaches it to the
      // sequence, and a translation names it as the material it belongs to.
      setMediaId(grantData.mediaId as string)

      // Straight to object storage. Routing this through our own API would
      // cap the file at the platform's request-body limit.
      const put = await api(grantData.uploadUrl as string, {
        method:  'PUT',
        body:    upload,
        headers: { 'Content-Type': uploadType },
      })
      if (!put.ok) throw new Error(put.status ? `La subida falló (HTTP ${put.status})` : put.error)

      setTranscribeJob({ message: 'Transcribiendo…', progress: 75 })
      const data = await must('/api/transcribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mediaId:  grantData.mediaId,
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

/** 16-bit mono PCM of the first channel, for a master too big to upload whole. */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const samples    = buffer.getChannelData(0)
  const dataLength = samples.length * 2
  const wav        = new ArrayBuffer(44 + dataLength)
  const v          = new DataView(wav)
  const ws  = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  const w32 = (off: number, n: number) => v.setUint32(off, n, true)
  const w16 = (off: number, n: number) => v.setUint16(off, n, true)
  ws(0, 'RIFF'); w32(4, 36 + dataLength); ws(8, 'WAVE')
  ws(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1)
  w32(24, buffer.sampleRate); w32(28, buffer.sampleRate * 2); w16(32, 2); w16(34, 16)
  ws(36, 'data'); w32(40, dataLength)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2
  }
  return wav
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
