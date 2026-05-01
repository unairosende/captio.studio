'use client'

import { useState, useRef } from 'react'
import type { Subtitle } from '@/types/subtitle'
import { charStatus, wordDiff } from '@/lib/reflow'

interface Props {
  sub: Subtitle
  limit: number
  editable?: boolean
  backSub?: Subtitle
  sourceSub?: Subtitle
  onCommit?: (index: number, text: string) => void
}

export default function SubtitleCard({ sub, limit, editable, backSub, sourceSub, onCommit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(sub.text)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const st      = charStatus(sub.text, limit)
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

  const draftSt      = charStatus(draft, limit)
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
