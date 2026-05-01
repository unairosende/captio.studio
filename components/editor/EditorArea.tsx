'use client'

import { useRef } from 'react'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import { maxLen } from '@/lib/exporters'
import { charStatus, reflowText } from '@/lib/reflow'
import SubtitleCard from './SubtitleCard'

export default function EditorArea() {
  const {
    subtitles, translations, backTranslations,
    activeTab, outputMode, viewMode,
    updateSubtitle, getFinalSubs,
    setTranslateJob, translateJob, backTranslateJob,
    backTranslations: bts, setBackTranslation, clearBackTranslation,
    activeProvider, activeModel, allowRephrase, srcLang, tgtLang,
    setBackTranslateJob,
  } = useSubtitleStore()

  const limit      = maxLen(outputMode)
  const isSource   = activeTab === 'source'
  const hasTrans   = !isSource && !!translations[activeTab]
  const activeSubs = isSource ? subtitles : (hasTrans ? getFinalSubs(activeTab) : [])
  const bt         = hasTrans ? bts[activeTab] : undefined

  const warns = activeSubs.filter(s => charStatus(s.text, limit) === 'warn').length
  const errs  = activeSubs.filter(s => charStatus(s.text, limit) === 'error').length

  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  function syncScroll(from: HTMLDivElement, to: HTMLDivElement) {
    const ratio = from.scrollTop / ((from.scrollHeight - from.clientHeight) || 1)
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
  }

  async function handleFixOverlength() {
    if (isSource || !hasTrans) return
    const lang = activeTab
    const subs = translations[lang]
    const toFix = subs.filter(s => charStatus(s.text, limit) === 'error')
    if (!toFix.length) return

    if (!allowRephrase) {
      toFix.forEach(s => {
        const reflowed = reflowText(s.text, limit)
        if (reflowed !== s.text) updateSubtitle(lang, s.index, reflowed)
      })
      return
    }

    setTranslateJob({ running: true, message: `Fixing ${toFix.length} subtitles…`, progress: 0, error: null })
    const BATCH = 15
    for (let i = 0; i < toFix.length; i += BATCH) {
      const batch = toFix.slice(i, i + BATCH)
      const srcTexts = batch.map(s => subtitles.find(o => o.index === s.index)?.text ?? '')
      const prompt = `You are a professional subtitle editor. Each subtitle in ${lang} is too long (max ${limit} chars/line, max 2 lines). Rephrase each one slightly to fit — keep the exact same meaning. Split into 2 lines using \\n where natural. Return ONLY a JSON array of strings, one per subtitle, no extra text.\n\nSource texts:\n${JSON.stringify(srcTexts)}\n\nCurrent translations:\n${JSON.stringify(batch.map(s => s.text))}`
      try {
        const res  = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: activeProvider, model: activeModel, prompt }) })
        const data = await res.json()
        let parsed: string[]
        try { parsed = JSON.parse(data.text.replace(/```json\n?|```\n?/g, '').trim()) } catch { parsed = batch.map(s => s.text) }
        batch.forEach((s, j) => { if (parsed[j]) updateSubtitle(lang, s.index, parsed[j]) })
        setTranslateJob({ progress: Math.round((i + batch.length) / toFix.length * 100) })
      } catch { break }
    }
    setTranslateJob({ running: false, message: 'Fixed', progress: 100 })
  }

  async function handleBackTranslate() {
    if (!hasTrans) return
    const lang = activeTab
    if (bts[lang]) { clearBackTranslation(lang); return }

    const subs    = translations[lang]
    const srcLangLabel = srcLang === 'Auto-detect' ? 'the original language' : srcLang
    setBackTranslateJob({ running: true, message: 'Back-translating…', progress: 0, error: null })

    const BATCH = 30
    const result: typeof subs = []
    for (let i = 0; i < subs.length; i += BATCH) {
      const batch  = subs.slice(i, i + BATCH)
      const prompt = `You are a professional subtitle translator. Translate each subtitle from ${lang} back to ${srcLangLabel}.\nRules:\n- Translate literally and accurately — this is for quality checking\n- Keep line breaks using \\n if the source has them\n- Return ONLY a JSON array of strings, one per subtitle, in order\n- No explanations, no markdown, no extra text\n\nSource subtitles (JSON array):\n${JSON.stringify(batch.map(s => s.text))}`
      try {
        const res  = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: activeProvider, model: activeModel, prompt }) })
        const data = await res.json()
        let parsed: string[]
        try { parsed = JSON.parse(data.text.replace(/```json\n?|```\n?/g, '').trim()) } catch { parsed = batch.map(s => s.text) }
        batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
        setBackTranslateJob({ progress: Math.round((i + batch.length) / subs.length * 100) })
      } catch (e: unknown) {
        setBackTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        return
      }
    }
    setBackTranslation(lang, result)
    setBackTranslateJob({ running: false, message: 'Done', progress: 100, error: null })
  }

  const renderCard = (s: typeof activeSubs[0], editable: boolean) => {
    const backSub   = bt?.find(b => b.index === s.index)
    const sourceSub = subtitles.find(o => o.index === s.index)
    return (
      <SubtitleCard
        key={s.index}
        sub={s}
        limit={limit}
        editable={editable}
        backSub={backSub}
        sourceSub={sourceSub}
        onCommit={(idx, text) => updateSubtitle(activeTab, idx, text)}
      />
    )
  }

  const DropZone = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40, textAlign: 'center', border: '2px dashed var(--border2)', borderRadius: 10, margin: 16 }}>
      <div style={{ fontSize: 38, opacity: .4 }}>⬚</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)' }}>Import a subtitle file from the sidebar</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>SRT · TXT · CSV — or use Transcribe for audio/video</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* View toolbar */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {(['list', 'compare'] as const).map(m => (
          <button key={m} onClick={() => useSubtitleStore.getState().setViewMode(m)}
            style={{ padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none', background: viewMode === m ? 'var(--bg3)' : 'transparent', color: viewMode === m ? 'var(--text)' : 'var(--text3)', transition: 'all .15s' }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
        <span style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--accent-dim)', color: '#8ba8ff' }}>
          {activeSubs.length} subs
        </span>
        {warns > 0 && <span style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--amber-dim)', color: 'var(--amber)' }}>{warns} warnings</span>}
        {errs  > 0 && <span style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--red-dim)',   color: 'var(--red)'   }}>{errs} errors</span>}
        {errs > 0 && hasTrans && (
          <button onClick={handleFixOverlength} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid #5a1a1a', background: 'var(--red-dim)', color: 'var(--red)', transition: 'all .15s' }}>
            ✦ Fix
          </button>
        )}
        {hasTrans && (
          <button onClick={handleBackTranslate} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: `1px solid ${bt ? 'var(--accent)' : 'var(--border)'}`, background: bt ? 'var(--accent-dim)' : 'transparent', color: bt ? '#8ba8ff' : 'var(--text3)', transition: 'all .15s' }}>
            {backTranslateJob.running ? <span className="spinner" /> : '↩'}
            {bt ? 'Hide back-trans' : 'Back-translate'}
          </button>
        )}
        {hasTrans && (
          <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto', fontStyle: 'italic' }}>
            Click any subtitle to edit
          </span>
        )}
      </div>

      {/* Editor area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {viewMode === 'compare' && hasTrans ? (
          <>
            {/* Left: source */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
              <div style={{ padding: '7px 14px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', flexShrink: 0, display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 500 }}>Original</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{subtitles.length} entries</span>
              </div>
              <div ref={leftRef} onScroll={() => rightRef.current && syncScroll(leftRef.current!, rightRef.current)} style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                {subtitles.map(s => renderCard(s, false))}
              </div>
            </div>
            {/* Right: translation */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '7px 14px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', flexShrink: 0, display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 500 }}>{activeTab}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{activeSubs.length} entries</span>
              </div>
              <div ref={rightRef} onScroll={() => leftRef.current && syncScroll(rightRef.current!, leftRef.current)} style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                {activeSubs.map(s => renderCard(s, true))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '7px 14px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', flexShrink: 0 }}>
              <span style={{ fontWeight: 500, fontSize: 12 }}>
                {isSource ? `Original · ${subtitles.length} entries` : `${activeTab} · ${activeSubs.length} entries`}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              {activeSubs.length ? activeSubs.map(s => renderCard(s, hasTrans)) : <DropZone />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
