'use client'

import { useRouter } from 'next/navigation'

import { termsInForce, useSubtitleStore } from '@/store/useSubtitleStore'
import { api, must } from '@/lib/api'
import { decodeAudio } from '@/lib/audio/decode'
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
  recall,
  rowsToCsv,
  rowsToXlsx,
  sheetRows,
  slugify,
} from '@/lib/subtitles'
import type { Playback } from '@/types/media'
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
    const { subtitles, srcLang, outputMode, sequenceId, mediaId, projectId, setTranslateJob, setTranslation } =
      useSubtitleStore.getState()
    const glossary = termsInForce(useSubtitleStore.getState())
    if (!lang || !subtitles.length) return

    const BATCH = TRANSLATION_BATCH
    const PAUSE = TRANSLATION_PAUSE_MS
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const translated = new Map<number, Subtitle>()

    setTranslateJob({ running: true, progress: 0, message: 'Traduciendo…', error: null })

    // Lines somebody already corrected into this language, in this project or
    // another of the client's, go as they were left instead of to the model.
    // Without the memory the translation still runs, as it always did.
    //
    // shortcut: a track whose every line is remembered is translated without a
    // request, so a never-billed import identical to earlier work costs no
    // minutes — vanishingly rare; bill it here if it ever is not.
    const memory = projectId
      ? await api<{ memory?: Record<string, string> }>(`/api/projects/${projectId}/memory?lang=${encodeURIComponent(lang)}`)
      : null
    const remembered = memory?.ok ? memory.json.memory ?? {} : {}
    for (const s of subtitles) {
      const text = recall(remembered, s.text)
      if (text !== undefined) translated.set(s.index, { ...s, text, machine: text })
    }
    const todo = subtitles.filter(s => !translated.has(s.index))

    for (let i = 0; i < todo.length; i += BATCH) {
      if (i > 0) {
        for (let c = Math.round(PAUSE / 1000); c > 0; c--) {
          setTranslateJob({ message: `Traduciendo… ${i}/${todo.length} — siguiente lote en ${c} s` })
          await sleep(1000)
        }
      }
      const batch = todo.slice(i, i + BATCH)

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
        // `machine` is the translation's own, not the source cue's it was spread from.
        batch.forEach((s, j) => translated.set(s.index, { ...s, text: parsed[j] ?? s.text, machine: parsed[j] }))
        setTranslateJob({
          progress: Math.round((i + batch.length) / todo.length * 100),
          message: `Traduciendo… ${Math.min(i + BATCH, todo.length)}/${todo.length}`,
        })
      } catch (e: unknown) {
        setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        // The batches before this one were paid for.
        spent()
        return
      }
    }

    const result = subtitles.map(s => translated.get(s.index) ?? s)
    const recalled = subtitles.length - todo.length
    setTranslation(lang, result)
    setTranslateJob({
      running: false,
      progress: 100,
      message: `Listo — ${result.length} cues${recalled ? `, ${recalled} de la memoria` : ''}`,
      error: null,
    })
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
    const glossary = termsInForce(useSubtitleStore.getState())
    const file = playback?.file
    if (!file) return
    setTranscribeJob({ running: true, progress: 30, message: 'Preparando el archivo…', error: null })

    try {
      const isVideo = playback.contentType.startsWith('video/')

      // Whole, so it plays back from the bucket later — unless it is a master
      // that would not fit, in which case the audio alone goes, as it always
      // did, and playback stays local to this session.
      let upload: Blob = file
      let uploadName = file.name
      let uploadType = playback.contentType
      if (file.size > MAX_UPLOAD_BYTES) {
        setTranscribeJob({ message: 'Demasiado grande para subir entero — extrayendo el audio…', progress: 40 })
        // Decoded again rather than held since loading: a feature's samples
        // kept in memory for a transcription nobody may ask for is the wrong
        // way round, and only a master this size needs them twice.
        const decoded = await decodeAudio(file)
        if (!decoded) throw new Error('El archivo pasa de 1 GB y no se pudo extraer el audio para subirlo')
        upload = new Blob([audioBufferToWav(decoded.buffer)], { type: 'audio/wav' })
        uploadName = file.name.replace(/\.[^.]+$/, '.wav')
        uploadType = 'audio/wav'
      }

      setTranscribeJob({ message: isVideo && upload === file ? 'Subiendo el vídeo…' : 'Subiendo el audio…', progress: 55 })

      // Remembered rather than used and forgotten: the save attaches it to the
      // sequence, and a translation names it as the material it belongs to.
      const mediaId = await uploadMedia(upload, uploadName, uploadType, playback)
      setMediaId(mediaId)

      setTranscribeJob({ message: 'Transcribiendo…', progress: 75 })
      const data = await must('/api/transcribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mediaId,
          language: language !== 'auto' ? language : undefined,
          outputMode,
          glossary,
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

/**
 * A file up to the bucket: a grant from our API, then the bytes straight to
 * object storage — routing them through our own API would cap the file at the
 * platform's request-body limit. Resolves to the row's id only once the object
 * is there, so nothing gets to name an upload that never arrived.
 */
export async function uploadMedia(
  blob: Blob,
  filename: string,
  contentType: string,
  meta: Pick<Playback, 'durationSeconds' | 'peaks'>,
): Promise<string> {
  const grant = await must('/api/media', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      filename,
      contentType,
      bytes: blob.size,
      // Read off the file when it was loaded; absent when it would not decode.
      durationSeconds: meta.durationSeconds ?? undefined,
      peaks: meta.peaks.length ? meta.peaks : undefined,
    }),
  })
  const put = await api(grant.uploadUrl as string, {
    method:  'PUT',
    body:    blob,
    headers: { 'Content-Type': contentType },
  })
  if (!put.ok) throw new Error(put.status ? `La subida falló (HTTP ${put.status})` : put.error)
  return grant.mediaId as string
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
