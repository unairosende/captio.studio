'use client'

import { useMemo, type KeyboardEvent } from 'react'

import { cueCps, qcForMode, qcTrack, srtToSec } from '@/lib/subtitles'
import { seekTo } from '@/lib/timeline/playhead'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Subtitle } from '@/types/subtitle'

import s from './editor.module.css'
import { langCode, sourceLabel } from './useJobs'

export type Filter = 'warn' | 'error' | 'noted' | null

interface Props {
  filter: Filter
  onFilter: (f: Filter) => void
  /** Enter on a row, or a double click: go and edit it in the inspector. */
  onOpen: () => void
  /** The table is empty and somebody has to be sent to the first step. */
  onImport: () => void
}

/**
 * The cues, one per row, both languages on the same line.
 *
 * Fixed rows of 56 px: a list read with the eye cannot have rows of
 * unpredictable height, so a line that does not fit is cut and the counter
 * says so; the whole text lives in the inspector. The only colour is the
 * tick in the margin — amber over the reading speed, red past it — and the
 * selected row is neutral, so the two can never be confused.
 */
export default function CueTable({ filter, onFilter, onOpen, onImport }: Props) {
  const {
    subtitles, translations, activeTab, outputMode, srcLang, glossary, comments, reviewNotes, translateJob,
    selected, select, switchToTab, closeTab, getFinalSubs,
  } = useSubtitleStore()

  const qc = useMemo(() => qcForMode(outputMode), [outputMode])
  const isSource = activeTab === 'source'
  const activeTrack = isSource ? undefined : translations[activeTab]
  const activeSubs = useMemo(
    () => (isSource ? subtitles : activeTrack ? getFinalSubs(activeTab) : []),
    [isSource, subtitles, activeTrack, getFinalSubs, activeTab],
  )

  // The full check — reading speed, duration, gaps, glossary — not just the
  // character count. The glossary is held against the translation only.
  const quality = useMemo(
    () => qcTrack(activeSubs, qc, isSource ? [] : glossary),
    [activeSubs, qc, isSource, glossary],
  )
  const langs = Object.keys(translations)
  /** Errors per language, for the tab. Cheap: the whole check is milliseconds. */
  const issuesByLang = useMemo(
    () => Object.fromEntries(Object.keys(translations).map(l => [l, [...qcTrack(getFinalSubs(l), qc, glossary).values()].filter(q => q.status === 'error').length])),
    [translations, getFinalSubs, qc, glossary],
  )

  const warns = [...quality.values()].filter(q => q.status === 'warn').length
  const errs  = [...quality.values()].filter(q => q.status === 'error').length
  const notes = !isSource ? reviewNotes[activeTab] : undefined
  const noted = useMemo(() => new Set((notes ?? []).map(n => n.cue)), [notes])

  const shown =
    filter === 'noted' ? activeSubs.filter(c => noted.has(c.index))
    : filter ? activeSubs.filter(c => quality.get(c.index)?.status === filter)
    : activeSubs

  const bySource = useMemo(() => new Map(subtitles.map(c => [c.index, c])), [subtitles])
  const openOn = useMemo(() => {
    const m = new Map<number, number>()
    comments.forEach(c => { if (!c.resolved) m.set(c.cue_index, (m.get(c.cue_index) ?? 0) + 1) })
    return m
  }, [comments])

  function choose(c: Subtitle) {
    select(c.index)
    // Listening where the eye is: a selected cue moves the playhead to its start.
    seekTo(srtToSec(c.start))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!shown.length) return
    const at = shown.findIndex(c => c.index === selected)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
      choose(next)
      ;(e.currentTarget.querySelector(`[data-cue="${next.index}"]`) as HTMLElement | null)?.focus()
    } else if (e.key === 'Enter' && selected !== null) {
      e.preventDefault()
      onOpen()
    }
  }

  if (!subtitles.length) {
    return (
      <div className={s.main}>
        <div className={s.emptyWrap}>
          <div className="empty">
            <span className="empty-title">Ningún cue todavía</span>
            <p>Abre un archivo de subtítulos, pega el texto, o sube un audio para transcribirlo. Los pasos están a la izquierda.</p>
            <button className="btn btn-primary" onClick={onImport}>Empezar por importar</button>
          </div>
        </div>
      </div>
    )
  }

  const srcLabel = sourceLabel(srcLang)

  return (
    <div className={s.main}>
      <div className={s.tabsBar}>
        <div className="tabs" role="tablist" aria-label="Idiomas">
          <button className="tab" role="tab" aria-selected={isSource} onClick={() => switchToTab('source')}>{srcLabel}</button>
          {langs.map(lang => {
            const busy = translateJob.running && translateJob.message.includes(langCode(lang))
            const n = issuesByLang[lang]
            return (
              <button key={lang} className="tab" role="tab" aria-selected={activeTab === lang} aria-busy={busy || undefined}
                data-issues={n > 0 ? n : undefined} onClick={() => switchToTab(lang)}>
                {langCode(lang)}
                <span className={s.tabClose} role="button" tabIndex={-1} aria-label={`Quitar ${lang}`} title={`Quitar ${lang}`}
                  onClick={e => { e.stopPropagation(); if (confirm(`¿Quitar ${lang} de esta secuencia?`)) closeTab(lang) }}>×</span>
              </button>
            )
          })}
        </div>
        <span className="muted">{langs.length ? `${langs.length} ${langs.length > 1 ? 'idiomas' : 'idioma'}` : 'sin traducir'}</span>
      </div>

      <div className={s.summary}>
        <span><b>{filter ? `${shown.length} de ${activeSubs.length}` : activeSubs.length}</b> cues</span>
        {warns > 0 && <button className={s.count} data-tone="warn" aria-pressed={filter === 'warn'} onClick={() => onFilter(filter === 'warn' ? null : 'warn')}>{warns} avisos</button>}
        {errs > 0 && <button className={s.count} data-tone="danger" aria-pressed={filter === 'error'} onClick={() => onFilter(filter === 'error' ? null : 'error')}>{errs} errores</button>}
        {!!notes?.length && <button className={s.count} data-tone="note" aria-pressed={filter === 'noted'} onClick={() => onFilter(filter === 'noted' ? null : 'noted')}>{notes.length} notas</button>}
        <span className={s.keys}>
          <span className="kbd">↑↓</span> moverse · <span className="kbd">⏎</span> editar
        </span>
      </div>

      <div className={s.tableWrap} onKeyDown={onKey}>
        <div className="cues">
          <div className="cue-head">
            <span className="cue-n">#</span>
            <span>in · out</span>
            <span>{srcLabel}</span>
            <span>{isSource ? '' : langCode(activeTab)}</span>
            <span className="cue-stat">cps</span>
            <span className="cue-stat">car</span>
          </div>
          {shown.map(c => {
            const src = bySource.get(c.index)
            const q = quality.get(c.index)
            const cps = cueCps(c)
            const longest = Math.max(...c.text.split('\n').map(l => l.length))
            const open = openOn.get(c.index)
            const lines = (t?: string) => (t ?? '').split('\n').slice(0, 2)
            return (
              <div key={c.index} className="cue" data-cue={c.index} data-qc={q?.status === 'ok' ? undefined : q?.status}
                aria-selected={selected === c.index} tabIndex={0}
                onClick={() => choose(c)} onDoubleClick={() => { choose(c); onOpen() }}>
                <span className="cue-n" title={open ? `${open} comentarios abiertos` : undefined}>{c.index}{open ? <b className={s.dot} /> : null}</span>
                <span className="cue-tc">{c.start}<br />{c.end}</span>
                <div className="cue-text">{lines(src?.text).map((l, i) => <div key={i}>{l}</div>)}</div>
                <div className="cue-text">{isSource ? null : lines(c.text).map((l, i) => <div key={i}>{l}</div>)}</div>
                <span className="cue-stat">{cps === null ? '—' : cps.toFixed(1).replace('.', ',')}</span>
                <span className="cue-stat">{longest}/{qc.maxChars}</span>
              </div>
            )
          })}
          {shown.length === 0 && (
            <div className={s.emptyWrap}>
              <div className="empty">
                <span className="empty-title">Ningún cue con ese filtro</span>
                <p>Los {activeSubs.length} cues de {isSource ? 'el original' : langCode(activeTab)} están limpios en lo que pedías.</p>
                <button className="btn btn-quiet" onClick={() => onFilter(null)}>Quitar el filtro</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
