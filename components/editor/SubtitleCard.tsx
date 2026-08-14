'use client'

import { useState, useRef } from 'react'
import type { Subtitle } from '@/types/subtitle'
import { DEFAULT_QC, charStatus, wordDiff } from '@/lib/subtitles'
import type { QcIssue, Severity } from '@/lib/subtitles'

interface Props {
  sub: Subtitle
  limit: number
  /**
   * The full verdict, checked against the whole track.
   *
   * Passed in rather than computed here because half the checks need the
   * neighbouring cue — reading speed needs this cue's duration, the gap needs
   * the previous one's end. A card on its own can only ever count characters,
   * which is why it used to.
   */
  status?: Severity
  issues?: QcIssue[]
  editable?: boolean
  backSub?: Subtitle
  sourceSub?: Subtitle
  onCommit?: (index: number, text: string) => void
  /**
   * Splitting and deleting change the cue in every language at once, so they
   * are offered on every card — including one that is only being read.
   */
  onSplit?: (index: number) => void
  onDelete?: (index: number) => void
  /**
   * How many notes are on this cue, and how many are still open.
   *
   * Both, because a cue with four resolved comments and none open is settled,
   * and a badge that could not tell the two apart would send somebody off to
   * read an argument that finished last week.
   */
  comments?: { total: number; open: number }
  onComments?: (index: number) => void
}

export default function SubtitleCard({
  sub, limit, status, issues, editable, backSub, sourceSub, onCommit, onSplit, onDelete,
  comments, onComments,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(sub.text)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // The card is handed a width by its parent; the rest of the thresholds are
  // the standard ones.
  const qc      = { ...DEFAULT_QC, maxChars: limit }
  // Falls back to counting characters when nobody handed down a verdict, so
  // the card still works if it is ever rendered outside the editor.
  const st      = status ?? charStatus(sub.text, qc)
  const longest = Math.max(...sub.text.split('\n').map(l => l.length))
  const pct     = Math.min(100, Math.round(longest / limit * 100))

  const barColor = st === 'error' ? 'var(--red)' : st === 'warn' ? 'var(--amber)' : 'var(--green)'
  const cardCls  = `sub-card${st === 'error' ? ' error' : st === 'warn' ? ' warn' : ''}${editable ? ' editable' : ''}${editing ? ' editing' : ''}`

  function open() {
    if (!editable || editing) return
    setDraft(sub.text)
    setEditing(true)
    setTimeout(() => taRef.current?.focus(), 0)
  }

  function commit() {
    setEditing(false)
    onCommit?.(sub.index, draft)
  }

  function cancel() {
    setEditing(false)
    setDraft(sub.text)
  }

  const draftSt      = charStatus(draft, qc)
  const draftLongest = Math.max(...draft.split('\n').map(l => l.length))
  const draftPct     = Math.min(100, Math.round(draftLongest / limit * 100))
  const draftBarColor = draftSt === 'error' ? 'var(--red)' : draftSt === 'warn' ? 'var(--amber)' : 'var(--green)'

  const diffOps = (backSub && sourceSub) ? wordDiff(sourceSub.text, backSub.text) : null

  return (
    <div className={cardCls} onClick={open}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>
        #{sub.index}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', marginBottom: 5 }}>
        {sub.start} → {sub.end}
      </div>

      {/* Outside the hover-revealed tools: a cue somebody has questioned should
          say so without being pointed at. The other buttons stay hidden because
          they change the track; this one only opens a conversation. */}
      {onComments && comments && comments.total > 0 && !editing && (
        <button
          className={`cmt-badge${comments.open > 0 ? ' open' : ''}`}
          onClick={e => { e.stopPropagation(); onComments(sub.index) }}
          title={`${comments.total} comment${comments.total > 1 ? 's' : ''}, ${comments.open} open`}
        >
          💬 {comments.total}
        </button>
      )}

      {(onSplit || onDelete || onComments) && !editing && (
        // Stopped from bubbling: the card itself opens the editor on click, and
        // splitting a cue and then landing in a textarea of the half you did
        // not mean is worse than either on its own.
        <div className="card-tools" onClick={e => e.stopPropagation()}>
          {onComments && (
            <button title="Comment on this subtitle" onClick={() => onComments(sub.index)}>💬</button>
          )}
          {onSplit && (
            <button title="Split at the playhead" onClick={() => onSplit(sub.index)}>✂</button>
          )}
          {onDelete && (
            <button className="danger" title="Delete this subtitle" onClick={() => onDelete(sub.index)}>✕</button>
          )}
        </div>
      )}

      {editing ? (
        <>
          <textarea
            ref={taRef}
            value={draft}
            rows={Math.max(2, draft.split('\n').length + 1)}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }}
            style={{
              width: '100%', background: 'var(--bg0)', border: '1px solid var(--accent)',
              borderRadius: 4, color: 'var(--text)', fontSize: 13, padding: '6px 8px',
              resize: 'vertical', outline: 'none', lineHeight: 1.5, marginTop: 2,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: draftSt === 'ok' ? 'var(--text3)' : draftSt === 'warn' ? 'var(--amber)' : 'var(--red)' }}>
              {draftLongest}/{limit}
            </span>
            <div style={{ flex: 1, height: 2, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${draftPct}%`, background: draftBarColor, transition: 'width .3s' }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {sub.text}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: st === 'ok' ? 'var(--text3)' : st === 'warn' ? 'var(--amber)' : 'var(--red)' }}>
              {longest}/{limit}
            </span>
            <div style={{ flex: 1, height: 2, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width .3s' }} />
            </div>
          </div>

          {/* Say what is wrong, not just that something is. A red card with no
              reason sends somebody hunting for a line-length problem that is
              really a cue on screen for four tenths of a second. */}
          {issues && issues.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
              {issues.map((issue, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3, lineHeight: 1.5,
                    background: issue.level === 'error' ? 'var(--red-dim)' : 'var(--amber-dim)',
                    color: issue.level === 'error' ? 'var(--red)' : 'var(--amber)',
                  }}
                >
                  {issue.msg}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {diffOps && (
        <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>
            Back-trans
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, wordBreak: 'break-word' }}>
            {diffOps.map((op, i) =>
              op.type === 'eq'  ? <span key={i}>{op.val} </span> :
              op.type === 'ins' ? <span key={i} className="diff-ins">{op.val} </span> :
                                  <span key={i} className="diff-del">{op.val} </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
