'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import GlossaryPanel from '@/components/glossary/GlossaryPanel'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, QUICK_LANGS, LANG_CODES, TRANSLATION_BATCH, TRANSLATION_PAUSE_MS } from '@/lib/providers'
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
import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'

/**
 * A section heading.
 *
 * At module scope, like AllowanceMeter below: a component declared inside Sidebar
 * is a new component type on every render, so React unmounts the old one and
 * mounts a fresh one each time — which throws away the state of anything
 * underneath it.
 */
const S = ({ label }: { label: string }) => (
  <div className="caps" style={{ marginBottom: 9 }}>{label}</div>
)

export default function Sidebar({ entitlement }: { entitlement: Entitlement }) {
  const store = useSubtitleStore()
  const {
    subtitles, translations, activeTab, outputMode,
    srcLang, tgtLang, allowRephrase, glossary, sequenceName,
    sequenceId, mediaId, setMediaId,
    translateJob, transcribeJob,
    setSrcLang, setTgtLang, setAllowRephrase, setOutputMode,
    loadSubtitles, setTranslation, setTranslateJob, setTranscribeJob, clearAll,
  } = store

  const [importTab,  setImportTab]  = useState<'import' | 'transcribe'>('import')
  const [hint,       setHint]       = useState<ParseHint>('auto')
  // The formatter also writes ASS and TTML; the select just has not caught up.
  const [exportFmt,  setExportFmt]  = useState<SubtitleFormat>('srt')
  const [exportAllFmt, setExportAllFmt] = useState<'xlsx' | 'csv'>('xlsx')
  const [xcFile,     setXcFile]     = useState<File | null>(null)
  const [langCustom, setLangCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const fileRef   = useRef<HTMLInputElement>(null)
  const xcFileRef = useRef<HTMLInputElement>(null)

  const router = useRouter()

  /**
   * Money has been spent — go and read how much is left.
   *
   * The allowance meter is a prop from a server component, so it is only ever as
   * fresh as the last page load. Without this, somebody transcribes an episode
   * and the sidebar still shows the full hour: the warning that exists to
   * arrive *before* the wall arrives after it, on the next reload.
   *
   * `router.refresh()` re-runs the page on the server and leaves the editor's
   * own state alone, which is why the meter can be refetched mid-session
   * without the cues on screen flickering.
   */
  const spent = () => router.refresh()

  const hasSubs   = subtitles.length > 0
  const hasTrans  = activeTab !== 'source' && !!translations[activeTab]
  const langCount = Object.keys(translations).length
  const limit    = qcForMode(outputMode).maxChars

  // ── Import ──
  function handleFile(f: File) {
    const r = new FileReader()
    r.onload = ev => {
      const subs = parseContent(ev.target!.result as string, f.name, hint)
      loadSubtitles(subs)
    }
    r.readAsText(f)
  }

  function parsePaste() {
    const txt = (document.getElementById('pasteArea') as HTMLTextAreaElement).value.trim()
    if (!txt) return
    loadSubtitles(parseContent(txt, 'pasted.srt', hint))
  }

  // ── Translate ──
  async function startTranslation() {
    const lang    = showCustom ? langCustom.trim() : tgtLang
    if (!lang || !subtitles.length) return

    const BATCH   = TRANSLATION_BATCH
    const PAUSE   = TRANSLATION_PAUSE_MS
    const sleep   = (ms: number) => new Promise(r => setTimeout(r, ms))
    const result: typeof subtitles = []

    setTranslateJob({ running: true, progress: 0, message: 'Translating…', error: null })

    for (let i = 0; i < subtitles.length; i += BATCH) {
      if (i > 0) {
        for (let c = Math.round(PAUSE / 1000); c > 0; c--) {
          setTranslateJob({ message: `Translating… ${i}/${subtitles.length} — next batch in ${c}s…` })
          await sleep(1000)
        }
      }
      const batch  = subtitles.slice(i, i + BATCH)

      try {
        // Cues, not prose. The server composes the prompt, so a subscription
        // cannot be turned into a general-purpose model.
        const res  = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'translate',
            cues: batch.map(s => s.text),
            targetLang: lang,
            sourceLang: srcLang,
            outputMode,
            // Which material this belongs to. Plans are sold in minutes now, so
            // a translation that names neither an upload nor a saved sequence
            // has nothing the server can charge — and is refused.
            sequenceId,
            mediaId,
            // Sent with every batch. Each request is its own conversation, so a
            // term agreed in batch one is unknown by batch two unless repeated.
            glossary,
          }),
        })
        const data = await res.json().catch(() => {
        // A gateway that gives up answers with an HTML page, and `res.json()`
        // then fails on `<!DOCTYPE` — which reads as a bug in the reply rather
        // than as a request that was cut short before there was one.
        throw new Error(`The server answered ${res.status} without JSON — the request was probably cut short.`)
      }).catch(() => {
          // A gateway that gives up answers with an HTML page, and `res.json()`
          // then fails on `<!DOCTYPE` — which reads as a bug in the reply rather
          // than as a request that was cut short before there was one.
          throw new Error(`The server answered ${res.status} without JSON — the request was probably cut short.`)
        })
        if (data.error) throw new Error(data.error)
        // No falling back to the source text. A cue left in the original
        // language but presented as translated ships as finished work.
        const parsed: string[] = data.translations
        batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
        setTranslateJob({ progress: Math.round((i + batch.length) / subtitles.length * 100), message: `Translating… ${Math.min(i + BATCH, subtitles.length)}/${subtitles.length}` })
      } catch (e: unknown) {
        setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        // The batches before this one were paid for, and the one that failed may
        // have been refused for having nothing left to spend.
        spent()
        return
      }
    }

    setTranslation(lang, result)
    setTranslateJob({ running: false, progress: 100, message: `Done — ${result.length} subtitles`, error: null })
    spent()
  }

  // ── Transcribe ──
  async function startTranscription() {
    if (!xcFile) return
    setTranscribeJob({ running: true, progress: 30, message: 'Preparing audio…', error: null })

    try {
      let audioBlob: Blob = xcFile
      const isVideo = xcFile.type.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(xcFile.name)

      if (isVideo) {
        setTranscribeJob({ message: 'Extracting audio…', progress: 40 })
        audioBlob = await extractAudio(xcFile)
      }

      setTranscribeJob({ message: 'Uploading audio…', progress: 55 })
      const uploadName  = isVideo ? xcFile.name.replace(/\.[^.]+$/, '.mp3') : xcFile.name
      const contentType = audioBlob.type || 'audio/mpeg'

      const grant     = await fetch('/api/media', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: uploadName, contentType, bytes: audioBlob.size }),
      })
      const grantData = await grant.json().catch(() => {
        // A gateway that gives up answers with an HTML page, and `res.json()`
        // then fails on `<!DOCTYPE` — which reads as a bug in the reply rather
        // than as a request that was cut short before there was one.
        throw new Error(`The server answered ${grant.status} without JSON — the request was probably cut short.`)
      })
      if (!grant.ok) throw new Error(grantData.error ?? `HTTP ${grant.status}`)

      // Remembered rather than used and forgotten: the save attaches it to the
      // sequence, and a translation names it as the material it belongs to.
      setMediaId(grantData.mediaId)

      // Straight to object storage. Routing this through our own API would cap
      // the file at the platform's request-body limit — a couple of minutes of
      // audio — and bill us for carrying bytes we only hand onwards.
      const put = await fetch(grantData.uploadUrl, {
        method:  'PUT',
        body:    audioBlob,
        headers: { 'Content-Type': contentType },
      })
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`)

      setTranscribeJob({ message: 'Transcribing…', progress: 75 })
      const lang = (document.getElementById('xcSourceLang') as HTMLSelectElement).value

      const res  = await fetch('/api/transcribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mediaId:  grantData.mediaId,
          language: lang !== 'auto' ? lang : undefined,
          outputMode,
        }),
      })
      const data = await res.json().catch(() => {
        // A gateway that gives up answers with an HTML page, and `res.json()`
        // then fails on `<!DOCTYPE` — which reads as a bug in the reply rather
        // than as a request that was cut short before there was one.
        throw new Error(`The server answered ${res.status} without JSON — the request was probably cut short.`)
      })
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setTranscribeJob({ progress: 100 })
      // Already cues, already timecoded: the server cuts them from the word
      // timings so the boundaries obey the same rules as the quality checks.
      const segs: Subtitle[] = data.segments ?? []
      if (!segs.length) throw new Error('No speech found — the file may be silent')
      loadSubtitles(segs)
      setTranscribeJob({ running: false, message: `${segs.length} subtitles transcribed ✓`, error: null })
      setImportTab('import')
    } catch (e: unknown) {
      setTranscribeJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
    } finally {
      spent()
    }
  }

  // ── Export ──
  function download(filename: string, blob: Blob) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    // The object URL pins the blob in memory until the document goes away, and
    // a session of exports on a feature-length project is real memory.
    setTimeout(() => URL.revokeObjectURL(a.href), 0)
  }

  function doExport() {
    if (!hasTrans) return
    const subs = finalSubs(translations[activeTab], outputMode, qcForMode(outputMode))
    // The BOM matters: Excel misreads accented characters in UTF-8 CSV without
    // one, and some players expect it in SRT.
    const content =
      bomFor(exportFmt) + formatSubs(subs, exportFmt, { lang: activeTab, title: activeTab })
    download(`${slugify(activeTab)}.${exportFmt}`, new Blob([content], { type: 'text/plain;charset=utf-8' }))
  }

  /**
   * Every language in one sheet — the file a client is actually sent.
   *
   * Built from the translations as they are, not from what the SRT exporter
   * would write: in vertical mode that splits long cues, and a language split
   * three times where another was split twice puts the columns out of step for
   * the rest of the file. The sheet is keyed to the source cue list, which is
   * the thing every language does share.
   */
  function doExportAll() {
    const langs = Object.keys(translations)
    if (!subtitles.length || !langs.length) return

    const rows = sheetRows(subtitles, translations, langs)
    const name = `${slugify(sequenceName || 'subtitles')}_all_languages`

    if (exportAllFmt === 'csv') {
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

  return (
    <div style={{ width: 226, background: 'var(--bg1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>

      <AllowanceMeter entitlement={entitlement} />

      {/* Import / Transcribe */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', background: 'var(--bg2)', borderRadius: 6, padding: 2, gap: 2, marginBottom: 10 }}>
          {(['import', 'transcribe'] as const).map(t => (
            <button key={t} onClick={() => setImportTab(t)}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none', background: importTab === t ? 'var(--bg3)' : 'transparent', color: importTab === t ? 'var(--text)' : 'var(--text3)', textAlign: 'center', transition: 'all .15s', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {importTab === 'import' ? (
          <>
            <input ref={fileRef} type="file" accept=".srt,.txt,.csv" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) { handleFile(e.target.files[0]); e.target.value = '' } }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {/* data-cmd puts a button in the command palette. The palette
                  reads the page rather than keeping a list of its own, so a
                  button that is absent or disabled is a command not offered. */}
              <button data-cmd="Open a subtitle file" data-cmd-hint="SRT · TXT · CSV" onClick={() => fileRef.current?.click()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', transition: 'all .15s' }}>
                ↑ Open file
              </button>
              <button onClick={clearAll} disabled={!hasSubs} style={{ padding: '7px 10px', borderRadius: 6, fontSize: 13, cursor: hasSubs ? 'pointer' : 'not-allowed', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text3)', opacity: hasSubs ? 1 : .4, transition: 'all .15s' }}>
                ✕
              </button>
            </div>
            <textarea id="pasteArea" placeholder="Or paste SRT / CSV / TXT content…" rows={3}
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: 8, resize: 'vertical', outline: 'none', minHeight: 68, lineHeight: 1.5 }} />
            <button onClick={parsePaste} style={{ marginTop: 6, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', transition: 'all .15s' }}>
              Parse pasted content
            </button>
            <div style={{ marginTop: 9 }}>
              <div className="caps" style={{ marginBottom: 5 }}>Hint format</div>
              <select
                className="select"
                value={hint}
                onChange={e => setHint(e.target.value as ParseHint)}
              >
                <option value="auto">Auto-detect</option>
                <option value="srt">SRT</option>
                <option value="txt">TXT (one per line)</option>
                <option value="csv">CSV</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="caps" style={{ marginBottom: 6 }}>Audio language</div>
            <select id="xcSourceLang" className="select" style={{ marginBottom: 10, fontSize: 12 }}>
              <option value="auto">Auto-detect</option>
              {['en','es','fr','de','it','pt','nl','pl','ru','tr','ar','ja','ko','zh','ca'].map(c => (
                <option key={c} value={c}>{c.toUpperCase()}</option>
              ))}
            </select>

            <input ref={xcFileRef} type="file" accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.mov,.mkv,.aac,.ogg,.flac,.webm" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) { setXcFile(e.target.files[0]); e.target.value = '' } }} />
            {xcFile ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 11 }}>{xcFile.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{(xcFile.size / 1024 / 1024).toFixed(1)} MB</span>
                <span onClick={() => setXcFile(null)} style={{ cursor: 'pointer', color: 'var(--text3)', padding: '2px 4px', borderRadius: 3, fontSize: 14 }}>×</span>
              </div>
            ) : (
              <div onClick={() => xcFileRef.current?.click()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, textAlign: 'center', cursor: 'pointer', border: '2px dashed var(--border2)', borderRadius: 8, minHeight: 80 }}>
                <div style={{ fontSize: 22, opacity: .4 }}>🎙</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)' }}>Drop audio or video file</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>MP3 · MP4 · WAV · M4A · max 25MB</div>
              </div>
            )}

            {transcribeJob.message && (
              <div style={{ fontSize: 11, color: transcribeJob.error ? 'var(--red)' : transcribeJob.message.includes('✓') ? 'var(--green)' : 'var(--text3)', marginTop: 6, lineHeight: 1.4 }}>
                {transcribeJob.error ?? transcribeJob.message}
              </div>
            )}

            <button data-cmd="Transcribe the audio" onClick={startTranscription} disabled={!xcFile || transcribeJob.running}
              style={{ marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: xcFile && !transcribeJob.running ? 'pointer' : 'not-allowed', border: 'none', background: 'var(--accent)', color: '#fff', opacity: (!xcFile || transcribeJob.running) ? .4 : 1 }}>
              {transcribeJob.running ? <span className="spinner" /> : '🎙'} Transcribe
            </button>
          </>
        )}
      </div>

      {/* Source language */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Source language" />
        <select className="select" value={srcLang} onChange={e => setSrcLang(e.target.value)}>
          {SOURCE_LANGUAGES.map(l => <option key={l}>{l}</option>)}
        </select>
      </div>

      {/* Target language */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Target language" />
        <select className="select" value={showCustom ? '__custom__' : tgtLang} onChange={e => { if (e.target.value === '__custom__') { setShowCustom(true) } else { setShowCustom(false); setTgtLang(e.target.value) } }}>
          {TARGET_LANGUAGES.map(l => <option key={l}>{l}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
        {showCustom && (
          <input value={langCustom} onChange={e => setLangCustom(e.target.value)} placeholder="Type any language…"
            style={{ marginTop: 6, width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
          {QUICK_LANGS.map(l => {
            const code   = LANG_CODES[l]
            const active = !showCustom && tgtLang === l
            return (
              <span key={l} onClick={() => { setShowCustom(false); setTgtLang(l) }}
                style={{ padding: '3px 7px', background: active ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, fontSize: 11, color: active ? '#8ba8ff' : 'var(--text2)', cursor: 'pointer', fontFamily: 'var(--mono)' }}>
                {code}
              </span>
            )
          })}
        </div>
      </div>

      {/* Output format */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Output format" />
        {(['horizontal', 'vertical'] as const).map(m => (
          <div key={m} onClick={() => setOutputMode(m)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${outputMode === m ? 'var(--accent)' : 'transparent'}`, background: outputMode === m ? 'var(--accent-dim)' : 'transparent', marginBottom: 5 }}>
            <div style={{ width: 13, height: 13, borderRadius: '50%', border: `2px solid ${outputMode === m ? 'var(--accent)' : 'var(--border2)'}`, flexShrink: 0, position: 'relative' }}>
              {outputMode === m && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
            </div>
            <span style={{ fontSize: 13, color: outputMode === m ? 'var(--text)' : 'var(--text2)' }}>
              {m === 'horizontal' ? 'Horizontal' : 'Vertical (split long)'}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 8, padding: '7px 8px', background: 'var(--bg2)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
          <b style={{ color: 'var(--text2)' }}>Max chars/line:</b> {limit}<br />
          <b style={{ color: 'var(--text2)' }}>Auto-split:</b> {outputMode === 'vertical' ? 'on' : 'off'}
        </div>
      </div>

      {/* AI Settings */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="AI Settings" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, lineHeight: 1.3 }}>Allow rephrase to fit length</span>
          <label style={{ position: 'relative', width: 30, height: 17, flexShrink: 0 }}>
            <input type="checkbox" checked={allowRephrase} onChange={e => setAllowRephrase(e.target.checked)} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
            <div style={{ position: 'absolute', inset: 0, background: allowRephrase ? 'var(--accent-dim)' : 'var(--bg3)', border: `1px solid ${allowRephrase ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 17, cursor: 'pointer', transition: 'all .2s' }} />
            <div style={{ position: 'absolute', top: 2, left: allowRephrase ? 15 : 2, width: 11, height: 11, borderRadius: '50%', background: allowRephrase ? 'var(--accent)' : 'var(--text3)', transition: 'all .2s', pointerEvents: 'none' }} />
          </label>
        </div>
      </div>

      {/* Glossary */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <GlossaryPanel />
      </div>

      {/* Translate */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Translate" />
        <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden', marginBottom: 7 }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--green))', width: `${translateJob.progress}%`, transition: 'width .3s' }} />
        </div>
        <button data-cmd="Translate" data-cmd-hint="into the target language" onClick={startTranslation} disabled={!hasSubs || translateJob.running}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: hasSubs && !translateJob.running ? 'pointer' : 'not-allowed', border: 'none', background: 'var(--accent)', color: '#fff', opacity: (!hasSubs || translateJob.running) ? .4 : 1 }}>
          {translateJob.running ? <span className="spinner" /> : '⇄'} Translate
        </button>
        {(translateJob.message || translateJob.error) && (
          <div style={{ fontSize: 11, marginTop: 4, color: translateJob.error ? 'var(--red)' : translateJob.message.includes('Done') ? 'var(--green)' : 'var(--text3)', minHeight: 15, lineHeight: 1.4 }}>
            {translateJob.error ?? translateJob.message}
          </div>
        )}
      </div>

      {/* Export */}
      <div style={{ padding: '13px 12px 12px' }}>
        <S label="Export active tab" />
        <select className="select" value={exportFmt} onChange={e => setExportFmt(e.target.value as typeof exportFmt)} style={{ marginBottom: 8 }}>
          <option value="srt">SRT</option>
          <option value="txt">TXT</option>
          <option value="csv">CSV</option>
          <option value="vtt">VTT</option>
        </select>
        <button data-cmd="Export the tab on screen" onClick={doExport} disabled={!hasTrans}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: hasTrans ? 'pointer' : 'not-allowed', border: '1px solid #2a7a50', background: 'var(--green-dim)', color: 'var(--green)', opacity: hasTrans ? 1 : .4, transition: 'all .15s' }}>
          ↓ Export
        </button>
      </div>

      {/* Export every language as one sheet */}
      <div style={{ padding: '0 12px 14px' }}>
        <S label="Export all languages" />
        <select className="select" value={exportAllFmt} onChange={e => setExportAllFmt(e.target.value as typeof exportAllFmt)} style={{ marginBottom: 8 }}>
          <option value="xlsx">XLSX</option>
          <option value="csv">CSV</option>
        </select>
        <button data-cmd="Export every language as one sheet" data-cmd-hint="XLSX · CSV" onClick={doExportAll} disabled={!langCount}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: langCount ? 'pointer' : 'not-allowed', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', opacity: langCount ? 1 : .4, transition: 'all .15s' }}>
          ↓ {langCount ? `${langCount} language${langCount > 1 ? 's' : ''} in one sheet` : 'One sheet, all languages'}
        </button>
      </div>
    </div>
  )
}

/**
 * What is left, before any of it is spent — of the trial, or of the month a paid
 * plan includes.
 *
 * The paywall itself lives in the API routes, because a limit enforced by the
 * component that draws the button is not a limit. This is the warning — and the
 * warning is what decides whether reaching the limit feels like a product or an
 * ambush. Without it, the first news of a spent allowance arrives at the exact
 * moment somebody pressed Translate on a deadline. That applies to a paying
 * customer as much as to a trial: they are the ones with the deadline.
 *
 * Declared at module scope rather than inside Sidebar: a component defined
 * during render is a new type on every render, and React throws away the
 * subtree each time.
 */
function AllowanceMeter({ entitlement }: { entitlement: Entitlement }) {
  const meter =
    entitlement.status === 'subscribed'
      ? // Null when the plan is one this build cannot price, which getEntitlement
        // leaves uncapped on purpose. Drawing a meter there would show a ceiling
        // that is not being enforced.
        entitlement.monthly && {
          label: `${entitlement.monthly.plan} · this month`,
          figures:
            `${entitlement.monthly.remaining.toLocaleString('en-GB')} of ` +
            `${entitlement.monthly.limit.toLocaleString('en-GB')} subtitles left`,
          fraction: entitlement.monthly.remaining / entitlement.monthly.limit,
          nearly: 'See plans',
          spent: 'Month used up — see plans',
        }
      : {
          label: 'Free trial',
          figures: `${Math.floor(entitlement.remaining.mediaSeconds / 60)} min of material`,
          fraction: entitlement.remaining.mediaSeconds / (TRIAL.mediaMinutes * 60),
          nearly: 'Subscribe',
          spent: 'Used up — subscribe',
        }

  if (!meter) return null

  const spent = meter.fraction <= 0
  // Warned at a fifth left, which is still enough to finish something with.
  // A warning that arrives at zero is not a warning.
  const low = !spent && meter.fraction <= 0.2

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, lineHeight: 1.55, color: spent ? 'var(--red)' : low ? 'var(--amber)' : 'var(--text3)' }}>
      {/* Colour comes from the meter around it — red once the allowance is
          spent, amber when it is nearly — so this one heading does not take the
          class's own grey. */}
      <div className="caps" style={{ color: 'inherit', marginBottom: 3 }}>
        {meter.label}
      </div>
      <div style={{ fontFamily: 'var(--mono)' }}>
        {meter.figures}
      </div>
      {(spent || low) && (
        <a href="/pricing" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          {spent ? meter.spent : meter.nearly}
        </a>
      )}
    </div>
  )
}

async function extractAudio(file: File): Promise<Blob> {
  return new Promise(resolve => {
    const url   = URL.createObjectURL(file)
    const audio = new Audio()
    audio.src   = url
    audio.addEventListener('loadedmetadata', async () => {
      try {
        const sr       = 16000
        const ctx      = new OfflineAudioContext(1, Math.ceil(audio.duration * sr), sr)
        const src      = ctx.createBufferSource()
        const buf      = await file.arrayBuffer()
        const decoded  = await ctx.decodeAudioData(buf).catch(() => null)
        if (!decoded) { URL.revokeObjectURL(url); resolve(file); return }
        src.buffer = decoded; src.connect(ctx.destination); src.start(0)
        const rendered = await ctx.startRendering()
        URL.revokeObjectURL(url)
        resolve(new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' }))
      } catch { URL.revokeObjectURL(url); resolve(file) }
    })
    audio.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(file) })
  })
}

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
