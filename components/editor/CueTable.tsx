'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import { cueCps, qcForMode, qcTrack, srtToSec } from '@/lib/subtitles'
import { playheadSeconds, seekTo } from '@/lib/timeline/playhead'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle } from '@/types/subtitle'

import s from './editor.module.css'
import { ChevronIcon, PanelRightIcon } from './icons'
import { langCode, sourceLabel } from './useJobs'

export type Filter = 'warn' | 'error' | 'noted' | null

interface Props {
  userId: string
  filter: Filter
  onFilter: (f: Filter) => void
  /** The table is empty and somebody has to be sent to the first step. */
  onImport: () => void
  /** Whether the panel on the right is showing; the toolbar carries its switch. */
  panel: boolean
  onPanel: () => void
}

/** The column a text belongs to: the original, or a language. */
type Col = 'source' | string

interface Editing { index: number; col: Col; caret: number }

/**
 * The cues, one per row, corrected where they are read.
 *
 * A language is a tab, like a file in a text editor; the original is one
 * too. One tab fills the width, or every language sits in its own column
 * with the rows aligned by cue. Fixed rows of 56 px either way: a list read
 * with the eye cannot have rows of unpredictable height, so a line that does
 * not fit is cut and the counter says so, and a field that gets three lines
 * scrolls rather than grows. The only colour is a dot — amber over the
 * reading speed, red past it — and the selected row is neutral, so the two
 * can never be confused.
 */
export default function CueTable({ userId, filter, onFilter, onImport, panel, onPanel }: Props) {
  const {
    subtitles, translations, activeTab, viewMode, outputMode, srcLang, glossary, comments, reviewNotes, translateJob, sequenceId,
    selected, select, switchToTab, closeTab, setViewMode, updateSubtitle, updateSource, pushUndo, splitSubtitle, deleteSubtitle, setComments,
  } = useSubtitleStore()

  const qc = useMemo(() => qcForMode(outputMode), [outputMode])
  const langs = Object.keys(translations)
  const allCols: Col[] = ['source', ...langs]
  /* Which languages stay out of the comparison. Two, three or all of them:
     four columns of text is a lot of text, and the choice is the reader's. */
  const [hidden, setHidden] = useState<Set<Col>>(() => new Set())
  const [chooser, setChooser] = useState(false)
  const compare = viewMode === 'compare' && langs.length > 0
  const columns: Col[] = compare ? allCols.filter(c => !hidden.has(c)) : [activeTab]

  function toggleCol(col: Col) {
    const next = new Set(hidden)
    if (next.has(col)) next.delete(col)
    else {
      if (allCols.length - next.size <= 2) return
      next.add(col)
      if (col === activeTab) switchToTab(allCols.find(c => !next.has(c))!)
    }
    setHidden(next)
  }

  useEffect(() => {
    if (!chooser) return
    const shut = () => setChooser(false)
    window.addEventListener('pointerdown', shut)
    return () => window.removeEventListener('pointerdown', shut)
  }, [chooser])

  /* The check on every language at once — reading speed, duration, gaps,
     glossary. Cheap: the whole thing is milliseconds. What is checked is the
     text as stored, not as it will be exported: the vertical layout splits a
     long cue at export, and a table that showed the split would number its
     rows differently from the ones being edited. */
  const qcByLang = useMemo(() => {
    const m = new Map<Col, ReturnType<typeof qcTrack>>()
    m.set('source', qcTrack(subtitles, qc, []))
    for (const l of Object.keys(translations)) m.set(l, qcTrack(translations[l] ?? [], qc, glossary))
    return m
  }, [subtitles, translations, qc, glossary])
  const byLang = useMemo(
    () => new Map(Object.keys(translations).map(l => [l, new Map((translations[l] ?? []).map(c => [c.index, c]))])),
    [translations],
  )
  const cueOf = (col: Col, index: number): Subtitle | undefined =>
    col === 'source' ? subtitles.find(c => c.index === index) : byLang.get(col)?.get(index)

  const quality = qcByLang.get(activeTab)
  const warns = quality ? [...quality.values()].filter(q => q.status === 'warn').length : 0
  const errs  = quality ? [...quality.values()].filter(q => q.status === 'error').length : 0
  const notes = activeTab !== 'source' ? reviewNotes[activeTab] : undefined
  const noted = useMemo(() => new Set((notes ?? []).map(n => n.cue)), [notes])

  const shown =
    filter === 'noted' ? subtitles.filter(c => noted.has(c.index))
    : filter ? subtitles.filter(c => quality?.get(c.index)?.status === filter)
    : subtitles

  const openOn = useMemo(() => {
    const m = new Map<number, number>()
    comments.forEach(c => { if (!c.resolved) m.set(c.cue_index, (m.get(c.cue_index) ?? 0) + 1) })
    return m
  }, [comments])

  /* ── Search: marks what it finds, ⏎ jumps ───────────────────────────────── */

  const [query, setQuery] = useState('')
  const [hit, setHit] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const matches: { index: number; col: Col }[] = []
  if (needle) {
    for (const c of shown) for (const col of columns) {
      if ((cueOf(col, c.index)?.text ?? '').toLowerCase().includes(needle)) matches.push({ index: c.index, col })
    }
  }

  function jump(i: number) {
    if (!matches.length) return
    const at = ((i % matches.length) + matches.length) % matches.length
    setHit(at)
    select(matches[at].index)
    document.querySelector(`[data-cue="${matches[at].index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // ⌘F is the search in here, not the browser's: what is looked for is a cue.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ── Editing: the cell becomes a field, the row does not move ──────────── */

  const [editing, setEditing] = useState<Editing | null>(null)
  const editCol: Col = columns.includes(activeTab) ? activeTab : columns[0]

  function startEdit(index: number, col: Col, caret: number) {
    if (col !== 'source' && col !== activeTab) switchToTab(col)
    setEditing({ index, col, caret })
  }
  function commit(index: number, col: Col, text: string) {
    const before = cueOf(col, index)?.text
    if (before === undefined || text === before) return
    // Committed once per edit, not per keystroke, so this is one step back.
    pushUndo()
    if (col === 'source') updateSource(index, text)
    else updateSubtitle(col, index, text)
  }
  function finishEdit(index: number) {
    setEditing(null)
    ;(document.querySelector(`[data-cue="${index}"]`) as HTMLElement | null)?.focus()
  }

  /* ── The cue's own actions: a menu where it was pressed, and ⌘K ─────────── */

  const [ctx, setCtx] = useState<{ x: number; y: number; index: number } | null>(null)
  const [thread, setThread] = useState<number | null>(null)

  useEffect(() => {
    if (!ctx) return
    const shut = () => setCtx(null)
    function onKey(e: globalThis.KeyboardEvent) { if (e.key === 'Escape') shut() }
    window.addEventListener('pointerdown', shut)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', shut, true)
    return () => { window.removeEventListener('pointerdown', shut); window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', shut, true) }
  }, [ctx])

  function comment(index: number) { if (sequenceId) setThread(index) }
  function split(index: number) { splitSubtitle(index, playheadSeconds() ?? undefined) }
  function remove(index: number) {
    if (confirm(`¿Borrar el cue ${index} en todos los idiomas?`)) { deleteSubtitle(index); select(null) }
  }

  function choose(c: Subtitle) {
    select(c.index)
    // Listening where the eye is: a selected cue moves the playhead to its start.
    seekTo(srtToSec(c.start))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || !shown.length) return
    const at = shown.findIndex(c => c.index === selected)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
      choose(next)
      ;(e.currentTarget.querySelector(`[data-cue="${next.index}"]`) as HTMLElement | null)?.focus()
    } else if (e.key === 'Enter' && selected !== null) {
      e.preventDefault()
      startEdit(selected, editCol, -1)
    }
  }

  if (!subtitles.length) {
    return (
      <div className={s.main}>
        <div className={s.emptyWrap}>
          <div className="empty">
            <span className="empty-title">Ningún cue todavía</span>
            <p>Abre un archivo de subtítulos, pega el texto, o sube un audio para transcribirlo. Los pasos están arriba.</p>
            <button className="btn btn-primary" onClick={onImport}>Empezar por importar</button>
          </div>
        </div>
      </div>
    )
  }

  const srcLabel = sourceLabel(srcLang)
  const label = (col: Col) => (col === 'source' ? srcLabel : langCode(col))
  const tone = (st?: string) => (st === 'error' ? 'danger' : st === 'warn' ? 'warn' : undefined)
  /** The worst thing the check found in a language, for its tab. */
  const worst = (col: Col) => {
    const m = qcByLang.get(col)
    if (!m) return undefined
    let w: 'warn' | undefined
    for (const q of m.values()) { if (q.status === 'error') return 'danger'; if (q.status === 'warn') w = 'warn' }
    return w
  }
  const cols = compare
    ? `36px 116px repeat(${columns.length}, minmax(0, 1fr))`
    : '36px 116px minmax(0, 1fr) 52px 56px'

  /** A language's tab: its name, what the check found, and the way to drop it. */
  const tab = (col: Col) => {
    const busy = col !== 'source' && translateJob.running && translateJob.message.includes(langCode(col))
    return (
      <button key={col} className="tab" role="tab" aria-selected={activeTab === col} aria-busy={busy || undefined} data-qc={worst(col)} onClick={() => switchToTab(col)}>
        <span>{label(col)}</span>
        <span className="tab-dot" />
        {col !== 'source' && (
          <span className="tab-x" role="button" tabIndex={-1} aria-label={`Quitar ${col}`} title={`Quitar ${col}`}
            onClick={e => { e.stopPropagation(); if (confirm(`¿Quitar ${col} de esta secuencia?`)) closeTab(col) }}>×</span>
        )}
      </button>
    )
  }

  return (
    <div className={s.main}>
      {thread !== null && sequenceId && (
        <CommentsPanel
          sequenceId={sequenceId}
          cueIndex={thread}
          lang={activeTab === 'source' ? null : activeTab}
          comments={comments}
          onChange={setComments}
          isMine={c => c.author_id === userId}
          onClose={() => setThread(null)}
        />
      )}

      <div className={s.toolbar}>
        <span><b>{filter ? `${shown.length} de ${subtitles.length}` : subtitles.length}</b> cues</span>
        {warns > 0 && <button className={s.count} data-tone="warn" aria-pressed={filter === 'warn'} onClick={() => onFilter(filter === 'warn' ? null : 'warn')}>{warns} avisos</button>}
        {errs > 0 && <button className={s.count} data-tone="danger" aria-pressed={filter === 'error'} onClick={() => onFilter(filter === 'error' ? null : 'error')}>{errs} errores</button>}
        {!!notes?.length && <button className={s.count} data-tone="note" aria-pressed={filter === 'noted'} onClick={() => onFilter(filter === 'noted' ? null : 'noted')}>{notes.length} notas</button>}

        <div className={s.view}>
          <div className="seg" role="group" aria-label="Vista">
            <button aria-pressed={!compare} onClick={() => setViewMode('list')}>Única</button>
            <button aria-pressed={compare} disabled={!langs.length} onClick={() => setViewMode('compare')}>Comparar</button>
          </div>
          {compare && (
            <div className={s.anchor} onPointerDown={e => e.stopPropagation()}>
              <button className="btn btn-quiet btn-icon" aria-label="Qué idiomas comparar" aria-expanded={chooser} onClick={() => setChooser(v => !v)}><ChevronIcon /></button>
              {chooser && (
                <div className={`menu ${s.pop} ${s.popLeft}`} role="menu">
                  <span className="caps">Comparar</span>
                  {allCols.map(col => (
                    <button key={col} className="menu-item" role="menuitemcheckbox" aria-checked={!hidden.has(col)}
                      disabled={!hidden.has(col) && columns.length <= 2} onClick={() => toggleCol(col)}>{label(col).replace(/^\w/, ch => ch.toUpperCase())}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={s.search}>
          <input
            ref={searchRef}
            className="field"
            value={query}
            placeholder="Buscar en los cues…"
            aria-label="Buscar en los cues"
            spellCheck={false}
            onChange={e => { setQuery(e.target.value); setHit(0) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? hit - 1 : hit + 1) }
              if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
            }}
          />
          {query && <span className={s.searchN}>{matches.length ? `${Math.min(hit, matches.length - 1) + 1}/${matches.length}` : '0'}</span>}
        </div>
        <span className={s.keys}>
          <span className="kbd">↑↓</span> moverse · <span className="kbd">⏎</span> editar · <span className="kbd">⌘K</span> acciones
        </span>
        <button className="btn btn-quiet btn-icon" aria-label={panel ? 'Plegar el panel' : 'Abrir el panel'} aria-pressed={panel} onClick={onPanel}><PanelRightIcon /></button>
      </div>

      <div className={s.tableWrap} onKeyDown={onKey}>
        <div className="cues" data-view={compare ? 'compare' : undefined} style={{ '--cols': cols } as CSSProperties}>
          {/* The header is the tab strip: one tab per language, and in the
              comparison one per column, so the names never scroll away. */}
          <div className="cue-tabs">
            <span className="cue-n">#</span>
            <span>in · out</span>
            {compare
              ? columns.map(tab)
              : <div className="tabs" role="tablist" aria-label="Idiomas">{allCols.map(tab)}</div>}
            {!compare && <><span className="cue-stat">cps</span><span className="cue-stat">car</span></>}
          </div>
          {shown.map(c => {
            const active = cueOf(activeTab, c.index)
            const text = active?.text ?? ''
            const cps = active ? cueCps(active) : null
            const longest = Math.max(...text.split('\n').map(l => l.length))
            const open = openOn.get(c.index)
            return (
              <div key={c.index} className="cue" data-cue={c.index} data-qc={tone(quality?.get(c.index)?.status)}
                aria-selected={selected === c.index} tabIndex={0}
                onClick={e => { if ((e.target as HTMLElement).tagName !== 'TEXTAREA') choose(c) }}
                onContextMenu={e => { e.preventDefault(); choose(c); setCtx({ x: e.clientX, y: Math.min(e.clientY, window.innerHeight - 180), index: c.index }) }}>
                <span className="cue-n" title={open ? `${open} comentarios abiertos` : undefined}>{c.index}{open ? <b className={s.dot} /> : null}</span>
                <span className="cue-tc">{c.start}<br />{c.end}</span>
                {columns.map(col => (
                  <Cell
                    key={col}
                    text={cueOf(col, c.index)?.text ?? ''}
                    query={needle}
                    qc={compare ? tone(qcByLang.get(col)?.get(c.index)?.status) : undefined}
                    active={col === activeTab}
                    editing={editing?.index === c.index && editing.col === col ? editing.caret : null}
                    onEdit={caret => startEdit(c.index, col, caret)}
                    onCommit={t => commit(c.index, col, t)}
                    onDone={() => finishEdit(c.index)}
                  />
                ))}
                {!compare && (
                  <>
                    <span className="cue-stat">{cps === null ? '—' : cps.toFixed(1).replace('.', ',')}</span>
                    <span className="cue-stat">{longest}/{qc.maxChars}</span>
                  </>
                )}
              </div>
            )
          })}
          {shown.length === 0 && (
            <div className={s.emptyWrap}>
              <div className="empty">
                <span className="empty-title">Ningún cue con ese filtro</span>
                <p>Los {subtitles.length} cues de {label(activeTab)} están limpios en lo que pedías.</p>
                <button className="btn btn-quiet" onClick={() => onFilter(null)}>Quitar el filtro</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {ctx && (
        <div className={`menu ${s.ctx}`} role="menu" style={{ left: ctx.x, top: ctx.y }} onPointerDown={e => e.stopPropagation()}>
          <span className="caps">Cue {ctx.index}</span>
          <button className="menu-item" role="menuitem" disabled={!sequenceId} title={sequenceId ? undefined : 'Guarda la secuencia para poder comentar'}
            onClick={() => { setCtx(null); comment(ctx.index) }}>
            Comentar{openOn.get(ctx.index) ? ` · ${openOn.get(ctx.index)} abiertos` : ''}
          </button>
          <button className="menu-item" role="menuitem" onClick={() => { setCtx(null); split(ctx.index) }}>Partir por el cabezal</button>
          <div className="menu-sep" />
          <button className="menu-item danger" role="menuitem" onClick={() => { setCtx(null); remove(ctx.index) }}>Borrar en todos los idiomas</button>
        </div>
      )}

      {/* The palette reads every [data-cmd] on the page; the menu above is
          only there while it is open, so the same three live here unseen. */}
      <span hidden>
        <button data-cmd="Buscar en los cues" data-cmd-hint="⌘F" onClick={() => searchRef.current?.focus()} />
        {langs.length > 0 && (compare
          ? <button data-cmd="Ver un solo idioma" onClick={() => setViewMode('list')} />
          : <button data-cmd="Comparar los idiomas" onClick={() => setViewMode('compare')} />)}
        {selected !== null && sequenceId && <button data-cmd="Comentar este cue" onClick={() => comment(selected)} />}
        {selected !== null && <button data-cmd="Partir el cue por el cabezal" onClick={() => split(selected)} />}
        {selected !== null && <button data-cmd="Borrar el cue" onClick={() => remove(selected)} />}
      </span>
    </div>
  )
}

/**
 * One text in one row: lines to read, or a field to correct them.
 *
 * The field is the same box with the same metrics as the lines, so the caret
 * lands where the pointer was. It is uncontrolled on purpose: the store hears
 * about the edit once, on leaving, and one edit is one step back.
 */
function Cell({ text, query, qc, active, editing, onEdit, onCommit, onDone }: {
  text: string
  /** What the search is looking for, lower-cased and trimmed. */
  query: string
  qc?: 'warn' | 'danger'
  /** Whether this is the language being corrected: the white column. */
  active: boolean
  /** The caret to start at while this cell is the one being edited, or null. */
  editing: number | null
  onEdit: (caret: number) => void
  onCommit: (text: string) => void
  onDone: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const skip = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (editing === null || !el) return
    skip.current = false
    el.focus()
    const at = editing < 0 ? el.value.length : Math.min(editing, el.value.length)
    el.setSelectionRange(at, at)
  }, [editing])

  if (editing !== null) {
    return (
      <div className="cue-text" data-qc={qc} data-active={active || undefined}>
        <textarea
          ref={ref}
          className="cue-edit"
          defaultValue={text}
          wrap="off"
          spellCheck
          aria-label="Texto del cue"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); skip.current = true; e.currentTarget.blur() }
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() }
          }}
          onBlur={e => { if (!skip.current) onCommit(e.currentTarget.value); onDone() }}
        />
      </div>
    )
  }

  return (
    <div className="cue-text" data-qc={qc} data-active={active || undefined}
      onMouseDown={e => { if (e.button === 0) { e.preventDefault(); onEdit(caretAt(e, e.currentTarget)) } }}>
      {text.split('\n').slice(0, 2).map((l, i) => <div key={i}>{highlight(l, query)}</div>)}
    </div>
  )
}

/** The text with what the search found wrapped in <mark>. */
function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text
  const hay = text.toLowerCase()
  const out: ReactNode[] = []
  let i = 0
  let at: number
  while ((at = hay.indexOf(needle, i)) !== -1) {
    if (at > i) out.push(text.slice(i, at))
    out.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>)
    i = at + needle.length
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

/**
 * Where in the text the pointer landed, as an offset into it — counting the
 * lines above, each with its newline — so the field can open with the caret
 * there. -1 when the browser cannot say, which puts it at the end.
 */
function caretAt(e: MouseEvent, root: HTMLElement): number {
  const d = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let off = 0
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(e.clientX, e.clientY)
    if (p) { node = p.offsetNode; off = p.offset }
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(e.clientX, e.clientY)
    if (r) { node = r.startContainer; off = r.startOffset }
  }
  if (!node || !root.contains(node)) return -1

  let count = 0
  for (const line of Array.from(root.children)) {
    const len = (line.textContent ?? '').length
    if (!line.contains(node)) { count += len + 1; continue }
    // Past the end of a line lands on the line itself, not on its text.
    if (node === line) return count + len
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let t: Node | null
    while ((t = walker.nextNode())) {
      if (t === node) return count + off
      count += (t.textContent ?? '').length
    }
    return count
  }
  return -1
}
