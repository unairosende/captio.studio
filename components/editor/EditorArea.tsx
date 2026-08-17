'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import { charStatus, qcForMode, qcTrack, reflowText } from '@/lib/subtitles'
import { playheadSeconds } from '@/lib/timeline/playhead'
import CommentsPanel from '@/components/comments/CommentsPanel'
import SubtitleCard from './SubtitleCard'

interface Props {
  /** Whose comments carry a delete button. Read from the session on the server. */
  userId: string
}

export default function EditorArea({ userId }: Props) {
  const {
    subtitles, translations, backTranslations,
    activeTab, outputMode, viewMode,
    updateSubtitle, getFinalSubs, pushUndo,
    setTranslateJob, translateJob, backTranslateJob,
    backTranslations: bts, setBackTranslation, clearBackTranslation,
    allowRephrase, srcLang, tgtLang,
    setBackTranslateJob,
    splitSubtitle, deleteSubtitle,
    comments, sequenceId,
  } = useSubtitleStore()

  /** The cue whose thread is open, if any. */
  const [commentCue, setCommentCue] = useState<number | null>(null)

  // One source of truth for the thresholds, so the character bar, the QC counts
  // and the reflow limit cannot disagree about what fits.
  const qc         = useMemo(() => qcForMode(outputMode), [outputMode])
  const limit      = qc.maxChars
  const isSource   = activeTab === 'source'
  const hasTrans   = !isSource && !!translations[activeTab]
  // Memoised because getFinalSubs derives a fresh array every call. Without
  // this the quality check below re-runs on every render — the memo would be
  // decoration, and the cost lands on exactly the long tracks it was there to
  // protect.
  const activeSubs = useMemo(
    () => (isSource ? subtitles : hasTrans ? getFinalSubs(activeTab) : []),
    [activeTab, getFinalSubs, hasTrans, isSource, subtitles],
  )
  const bt         = hasTrans ? bts[activeTab] : undefined

  /**
   * The full check, not just the character count.
   *
   * The core has always tested reading speed, duration and the gaps between
   * cues; the interface was only asking about line length and throwing the rest
   * away. A cue can be well within 42 characters and still flash past too fast
   * to read, which is the kind of thing a client notices and a character
   * counter never will.
   */
  const quality       = useMemo(() => qcTrack(activeSubs, qc), [activeSubs, qc])
  const sourceQuality = useMemo(() => qcTrack(subtitles, qc), [subtitles, qc])

  const warns = [...quality.values()].filter(q => q.status === 'warn').length
  const errs  = [...quality.values()].filter(q => q.status === 'error').length

  /** Narrow the list to what needs attention. Null shows everything. */
  const [filter, setFilter] = useState<'warn' | 'error' | null>(null)
  const shown = filter ? activeSubs.filter(s => quality.get(s.index)?.status === filter) : activeSubs

  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  // Re-reads the trial meter after anything that spends the allowance; see the
  // note in the sidebar, which does the same after a translation or a
  // transcription.
  const router = useRouter()

  function syncScroll(from: HTMLDivElement, to: HTMLDivElement) {
    const ratio = from.scrollTop / ((from.scrollHeight - from.clientHeight) || 1)
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
  }

  async function handleFixOverlength() {
    if (isSource || !hasTrans) return
    const lang = activeTab
    const subs = translations[lang]
    const toFix = subs.filter(s => charStatus(s.text, qc) === 'error')
    if (!toFix.length) return

    if (!allowRephrase) {
      // One step for the whole sweep. Fix rewrites every overlong cue at once,
      // and taking that back one cue at a time would be its own punishment.
      pushUndo()
      toFix.forEach(s => {
        const reflowed = reflowText(s.text, limit)
        if (reflowed !== s.text) updateSubtitle(lang, s.index, reflowed)
      })
      return
    }
    pushUndo()

    setTranslateJob({ running: true, message: `Fixing ${toFix.length} subtitles…`, progress: 0, error: null })
    const BATCH = 15
    for (let i = 0; i < toFix.length; i += BATCH) {
      const batch = toFix.slice(i, i + BATCH)
      const srcTexts = batch.map(s => subtitles.find(o => o.index === s.index)?.text ?? '')
      try {
        const res  = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'shorten',
            cues: batch.map(s => s.text),
            sourceTexts: srcTexts,
            targetLang: lang,
            outputMode,
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        const parsed: string[] = data.translations
        batch.forEach((s, j) => { if (parsed[j]) updateSubtitle(lang, s.index, parsed[j]) })
        setTranslateJob({ progress: Math.round((i + batch.length) / toFix.length * 100) })
      } catch { break }
    }
    setTranslateJob({ running: false, message: 'Fixed', progress: 100 })
    // Rewriting cues is a translation request like any other, and it comes out
    // of the same allowance. Re-read what is left rather than leaving the
    // sidebar showing a figure from before the sweep.
    router.refresh()
  }

  async function handleBackTranslate() {
    if (!hasTrans) return
    const lang = activeTab
    if (bts[lang]) { clearBackTranslation(lang); return }

    const subs    = translations[lang]
    setBackTranslateJob({ running: true, message: 'Back-translating…', progress: 0, error: null })

    const BATCH = 30
    const result: typeof subs = []
    for (let i = 0; i < subs.length; i += BATCH) {
      const batch  = subs.slice(i, i + BATCH)
      try {
        const res  = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'backTranslate',
            cues: batch.map(s => s.text),
            targetLang: lang,
            sourceLang: srcLang,
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        const parsed: string[] = data.translations
        batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
        setBackTranslateJob({ progress: Math.round((i + batch.length) / subs.length * 100) })
      } catch (e: unknown) {
        setBackTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        router.refresh()
        return
      }
    }
    setBackTranslation(lang, result)
    setBackTranslateJob({ running: false, message: 'Done', progress: 100, error: null })
    router.refresh()
  }

  const renderCard = (
    s: typeof activeSubs[0],
    editable: boolean,
    checks: ReturnType<typeof qcTrack> = quality,
  ) => {
    const backSub   = bt?.find(b => b.index === s.index)
    const sourceSub = subtitles.find(o => o.index === s.index)
    const check     = checks.get(s.index)
    const onCue     = comments.filter(c => c.cue_index === s.index)
    return (
      <SubtitleCard
        key={s.index}
        sub={s}
        limit={limit}
        status={check?.status}
        issues={check?.issues}
        editable={editable}
        backSub={backSub}
        sourceSub={sourceSub}
        onCommit={(idx, text) => {
          // Committed once per edit, not per keystroke, so this is one step.
          pushUndo()
          updateSubtitle(activeTab, idx, text)
        }}
        // Cut where the listening stopped. With no timeline loaded there is no
        // playhead, and the split falls back to the middle of the cue.
        onSplit={idx => splitSubtitle(idx, playheadSeconds() ?? undefined)}
        onDelete={deleteSubtitle}
        // A comment needs a project to hang from, so an unsaved editor gets no
        // button rather than a button that fails.
        comments={{ total: onCue.length, open: onCue.filter(c => !c.resolved).length }}
        onComments={sequenceId ? setCommentCue : undefined}
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
      {commentCue !== null && sequenceId && (
        <CommentsPanel
          sequenceId={sequenceId}
          cueIndex={commentCue}
          userId={userId}
          onClose={() => setCommentCue(null)}
        />
      )}

      {/* View toolbar */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {(['list', 'compare'] as const).map(m => (
          <button key={m} data-cmd={m === 'list' ? 'Show one language at a time' : 'Show the original beside the translation'} onClick={() => useSubtitleStore.getState().setViewMode(m)}
            style={{ padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none', background: viewMode === m ? 'var(--bg3)' : 'transparent', color: viewMode === m ? 'var(--text)' : 'var(--text3)', transition: 'all .15s' }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
        <span style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, background: 'var(--accent-dim)', color: '#8ba8ff' }}>
          {activeSubs.length} subs
        </span>
        {/* Counts you can act on: clicking narrows the list to exactly those
            cues, which is the difference between knowing there are eight
            problems and being able to fix them. */}
        {warns > 0 && (
          <button onClick={() => setFilter(f => (f === 'warn' ? null : 'warn'))}
            title={filter === 'warn' ? 'Show everything' : 'Show only warnings'}
            style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, cursor: 'pointer', background: 'var(--amber-dim)', color: 'var(--amber)', border: `1px solid ${filter === 'warn' ? 'var(--amber)' : 'transparent'}` }}>
            {warns} warnings
          </button>
        )}
        {errs > 0 && (
          <button onClick={() => setFilter(f => (f === 'error' ? null : 'error'))}
            title={filter === 'error' ? 'Show everything' : 'Show only errors'}
            style={{ padding: '2px 7px', borderRadius: 12, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 500, cursor: 'pointer', background: 'var(--red-dim)', color: 'var(--red)', border: `1px solid ${filter === 'error' ? 'var(--red)' : 'transparent'}` }}>
            {errs} errors
          </button>
        )}
        {filter && (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {shown.length} of {activeSubs.length} shown
          </span>
        )}
        {errs > 0 && hasTrans && (
          <button data-cmd="Fix the subtitles that are too long" onClick={handleFixOverlength} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid #5a1a1a', background: 'var(--red-dim)', color: 'var(--red)', transition: 'all .15s' }}>
            ✦ Fix
          </button>
        )}
        {hasTrans && (
          <button data-cmd={bt ? 'Hide the back-translation' : 'Back-translate to check the meaning'} onClick={handleBackTranslate} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: `1px solid ${bt ? 'var(--accent)' : 'var(--border)'}`, background: bt ? 'var(--accent-dim)' : 'transparent', color: bt ? '#8ba8ff' : 'var(--text3)', transition: 'all .15s' }}>
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
                {subtitles.map(s => renderCard(s, false, sourceQuality))}
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
              {activeSubs.length ? shown.map(s => renderCard(s, hasTrans)) : <DropZone />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
