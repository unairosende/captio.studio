'use client'

import { useState, useRef } from 'react'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import { parseContent } from '@/lib/parsers'
import { PROVIDERS, SOURCE_LANGUAGES, TARGET_LANGUAGES, QUICK_LANGS, LANG_CODES } from '@/lib/providers'
import { getFinalSubs, toSRT, toTXT, toCSV, toVTT, maxLen } from '@/lib/exporters'
import { secToSrt } from '@/lib/timecode'
import type { ProviderId } from '@/types/subtitle'

export default function Sidebar() {
  const store = useSubtitleStore()
  const {
    subtitles, translations, activeTab, outputMode,
    activeProvider, activeModel, srcLang, tgtLang, allowRephrase,
    translateJob, transcribeJob,
    setProvider, setModel, setSrcLang, setTgtLang, setAllowRephrase, setOutputMode,
    loadSubtitles, setTranslation, setTranslateJob, setTranscribeJob, clearAll,
  } = store

  const [importTab,  setImportTab]  = useState<'import' | 'transcribe'>('import')
  const [hint,       setHint]       = useState('auto')
  const [exportFmt,  setExportFmt]  = useState<'srt' | 'txt' | 'csv' | 'vtt'>('srt')
  const [xcProvider, setXcProvider] = useState<'groq' | 'openai'>('groq')
  const [xcFile,     setXcFile]     = useState<File | null>(null)
  const [langCustom, setLangCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const fileRef   = useRef<HTMLInputElement>(null)
  const xcFileRef = useRef<HTMLInputElement>(null)

  const hasSubs  = subtitles.length > 0
  const hasTrans = activeTab !== 'source' && !!translations[activeTab]
  const limit    = maxLen(outputMode)

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

    const srcNote = srcLang !== 'Auto-detect' ? ` from ${srcLang}` : ''
    const cfg     = PROVIDERS[activeProvider]
    const BATCH   = cfg.batchSize
    const PAUSE   = cfg.pauseMs
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
      const prompt = `You are a professional subtitle translator. Translate each subtitle${srcNote} to ${lang}.\nRules:\n- Preserve meaning and natural spoken rhythm\n- Keep line breaks using \\n if the source has them\n- Return ONLY a JSON array of strings, one per subtitle, in order\n- No explanations, no markdown, no extra text\n\nSource subtitles (JSON array):\n${JSON.stringify(batch.map(s => s.text))}`

      try {
        const res  = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: activeProvider, model: activeModel, prompt }) })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        let parsed: string[]
        try { parsed = JSON.parse(data.text.replace(/```json\n?|```\n?/g, '').trim()) } catch { parsed = batch.map(s => s.text) }
        batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
        setTranslateJob({ progress: Math.round((i + batch.length) / subtitles.length * 100), message: `Translating… ${Math.min(i + BATCH, subtitles.length)}/${subtitles.length}` })
      } catch (e: unknown) {
        setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        return
      }
    }

    setTranslation(lang, result)
    setTranslateJob({ running: false, progress: 100, message: `Done — ${result.length} subtitles`, error: null })
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

      setTranscribeJob({ message: 'Sending to Whisper…', progress: 65 })
      const fd = new FormData()
      fd.append('file', audioBlob, xcFile.name.replace(/\.[^.]+$/, '.mp3'))
      fd.append('model', xcProvider === 'groq' ? 'whisper-large-v3' : 'whisper-1')
      fd.append('response_format', 'verbose_json')
      fd.append('timestamp_granularities[]', 'segment')
      fd.append('xcProvider', xcProvider)
      const lang = (document.getElementById('xcSourceLang') as HTMLSelectElement).value
      if (lang !== 'auto') fd.append('language', lang)

      const res  = await fetch('/api/transcribe', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setTranscribeJob({ progress: 100 })
      const segs = data.segments ?? []
      if (!segs.length) throw new Error('No segments — file may be silent')
      loadSubtitles(segs.map((seg: { start: number; end: number; text: string }, i: number) => ({
        index: i + 1, start: secToSrt(seg.start), end: secToSrt(seg.end), text: seg.text.trim(),
      })))
      setTranscribeJob({ running: false, message: `${segs.length} subtitles transcribed ✓`, error: null })
      setImportTab('import')
    } catch (e: unknown) {
      setTranscribeJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
    }
  }

  // ── Export ──
  function doExport() {
    if (!hasTrans) return
    const subs = getFinalSubs(translations[activeTab], outputMode)
    const content = exportFmt === 'srt' ? toSRT(subs) : exportFmt === 'txt' ? toTXT(subs) : exportFmt === 'vtt' ? toVTT(subs) : toCSV(subs)
    const slug  = activeTab.toLowerCase().replace(/[^a-z]/g, '_')
    const blob  = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const a     = document.createElement('a')
    a.href      = URL.createObjectURL(blob)
    a.download  = `${slug}.${exportFmt}`
    a.click()
  }

  // ── UI helpers ──
  const S = ({ label }: { label: string }) => (
    <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 9 }}>{label}</div>
  )

  return (
    <div style={{ width: 226, background: 'var(--bg1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>

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
              <button onClick={() => fileRef.current?.click()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', transition: 'all .15s' }}>
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
              <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 5 }}>Hint format</div>
              <select className="select" value={hint} onChange={e => setHint(e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="srt">SRT</option>
                <option value="txt">TXT (one per line)</option>
                <option value="csv">CSV</option>
              </select>
            </div>
          </>
        ) : (
          <>
            {/* Whisper provider */}
            <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 7 }}>Whisper provider</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
              {(['groq', 'openai'] as const).map(p => (
                <button key={p} onClick={() => setXcProvider(p)}
                  style={{ padding: '7px 6px', background: xcProvider === p ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${xcProvider === p ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', color: xcProvider === p ? '#8ba8ff' : 'var(--text2)', cursor: 'pointer', textAlign: 'center' }}>
                  <span style={{ fontWeight: 500, display: 'block' }}>{p === 'groq' ? 'Groq' : 'OpenAI'}</span>
                  <span style={{ fontSize: 10, color: xcProvider === p ? 'var(--accent)' : 'var(--text3)', display: 'block', marginTop: 1 }}>{p === 'groq' ? 'Free · 2K/day' : '$0.006/min'}</span>
                </button>
              ))}
            </div>

            <div style={{ fontSize: 10, letterSpacing: '.08em', color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', marginBottom: 6 }}>Audio language</div>
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

            <button onClick={startTranscription} disabled={!xcFile || transcribeJob.running}
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

      {/* Provider */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Provider" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
          {(Object.keys(PROVIDERS) as ProviderId[]).map(id => {
            const active = activeProvider === id
            return (
              <button key={id} onClick={() => setProvider(id)}
                style={{ padding: '7px 6px', background: active ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', color: active ? '#8ba8ff' : 'var(--text2)', cursor: 'pointer', textAlign: 'center', lineHeight: 1.3 }}>
                <span style={{ fontWeight: 500, display: 'block' }}>{PROVIDERS[id].label}</span>
              </button>
            )
          })}
        </div>
        <select className="select" value={activeModel} onChange={e => setModel(e.target.value)} style={{ fontSize: 11 }}>
          {PROVIDERS[activeProvider].models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>{PROVIDERS[activeProvider].hint}</div>
      </div>

      {/* Translate */}
      <div style={{ padding: '13px 12px 12px', borderBottom: '1px solid var(--border)' }}>
        <S label="Translate" />
        <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden', marginBottom: 7 }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--green))', width: `${translateJob.progress}%`, transition: 'width .3s' }} />
        </div>
        <button onClick={startTranslation} disabled={!hasSubs || translateJob.running}
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
        <button onClick={doExport} disabled={!hasTrans}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: hasTrans ? 'pointer' : 'not-allowed', border: '1px solid #2a7a50', background: 'var(--green-dim)', color: 'var(--green)', opacity: hasTrans ? 1 : .4, transition: 'all .15s' }}>
          ↓ Export
        </button>
      </div>
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
