'use client'

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { srtToSec } from '@/lib/subtitles'
import { parseGoto } from '@/lib/timeline/goto'
import { seekTo } from '@/lib/timeline/playhead'
import { useSubtitleStore } from '@/store/useSubtitleStore'

/**
 * ⌘K.
 *
 * The palette this is modelled on was a menu with a search box that ignored what
 * you typed — its own placeholder promised to find a cue and take a timecode,
 * and neither worked. On a feature-length track those two are the reason to open
 * it at all: scrolling to line 812 by hand is the job it should be doing.
 *
 * The actions are read out of the page rather than listed here. Every one of
 * them is already a button somewhere in the editor, with its own conditions for
 * being there — Fix exists only while something is too long, Back-translate only
 * once there is a translation. Reading `[data-cmd]` when the palette opens means
 * it offers exactly what is genuinely available, and there is no second list to
 * keep in step with the first.
 */

interface Props {
  onClose: () => void
}

interface Item {
  key: string
  label: string
  hint?: string
  section: string
  run: () => void
}

/** Case- and accent-insensitive, so "cancion" finds "canción". */
const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const MAX_CUES = 8

export default function CommandPalette({ onClose }: Props) {
  const { subtitles, translations, activeTab, switchToTab } = useSubtitleStore()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * The buttons the editor is showing, read once on open.
   *
   * Once, because the page behind the overlay is not changing while somebody
   * types into it, and re-querying the DOM on every keystroke would be work for
   * an answer that cannot have moved.
   *
   * Read in the initialiser rather than in an effect: this component only exists
   * after somebody pressed ⌘K, so the editor it is reading is already on screen,
   * and an effect would mean a first paint of a palette with no commands in it.
   */
  const [actions] = useState<Item[]>(() => {
    if (typeof document === 'undefined') return []
    return Array.from(document.querySelectorAll<HTMLElement>('[data-cmd]'))
      .filter(el => !(el as HTMLButtonElement).disabled)
      .map((el, i) => ({
        key: `cmd-${i}`,
        label: el.dataset.cmd ?? '',
        hint: el.dataset.cmdHint,
        section: 'Actions',
        run: () => el.click(),
      }))
      .filter(a => a.label)
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const jumpToCue = useCallback(
    (index: number) => {
      // Scrolls only if the card is on screen — the quality filter may be hiding
      // it. The seek still happens, which is the half nobody can do by hand.
      document
        .querySelector(`[data-cue="${index}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const cue = subtitles.find(s => s.index === index)
      if (cue) seekTo(srtToSec(cue.start))
    },
    [subtitles],
  )

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const needle = fold(q.trim())

    const destination = parseGoto(q)
    if (destination?.kind === 'cue') {
      const exists = subtitles.some(s => s.index === destination.index)
      out.push({
        key: 'goto-cue',
        label: `Go to subtitle #${destination.index}`,
        hint: exists ? undefined : 'no such subtitle',
        section: 'Go to',
        run: () => { if (exists) jumpToCue(destination.index); onClose() },
      })
    }
    if (destination?.kind === 'time') {
      out.push({
        key: 'goto-time',
        label: `Seek to ${q.trim()}`,
        section: 'Go to',
        run: () => {
          // Says so rather than doing nothing: with no audio loaded there is no
          // timeline listening, and a silent no-op reads as a broken palette.
          if (!seekTo(destination.seconds)) alert('Load audio or video first')
          onClose()
        },
      })
    }

    for (const a of actions) {
      if (!needle || fold(a.label).includes(needle)) {
        out.push({ ...a, run: () => { a.run(); onClose() } })
      }
    }

    // Switching language is a command that only exists once there is a language
    // to switch to, so it is built here rather than hung off a button.
    for (const tab of ['source', ...Object.keys(translations)]) {
      if (tab === activeTab) continue
      const label = `Show ${tab === 'source' ? 'the original' : tab}`
      if (needle && !fold(label).includes(needle)) continue
      out.push({
        key: `tab-${tab}`,
        label,
        section: 'Actions',
        run: () => { switchToTab(tab); onClose() },
      })
    }

    if (needle && !destination) {
      const langSubs = activeTab === 'source' ? subtitles : translations[activeTab] ?? subtitles
      for (const s of langSubs.filter(x => fold(x.text).includes(needle)).slice(0, MAX_CUES)) {
        out.push({
          key: `cue-${s.index}`,
          label: s.text.replace(/\n/g, ' '),
          hint: `#${s.index} · ${s.start}`,
          section: 'Subtitles',
          run: () => { jumpToCue(s.index); onClose() },
        })
      }
    }

    return out
  }, [q, actions, subtitles, translations, activeTab, switchToTab, jumpToCue, onClose])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(items.length - 1, c + 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(0, c - 1))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      items[cursor]?.run()
    }
  }

  let lastSection = ''

  return (
    <div
      className="overlay"
      style={{ '--overlay-z': 70, '--overlay-top': '14vh' } as CSSProperties}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="panel" style={{ '--panel-w': '540px', '--panel-h': '60vh' } as CSSProperties}>
        <div className="panel-head">
          <span style={{ color: 'var(--text3)', fontSize: 'var(--fs-base)' }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            // The cursor goes back to the top here rather than in an effect
            // watching `q`: a filtered list is a different list, and leaving the
            // cursor on row six of a list that now has two would run whatever
            // happens to be sitting there.
            onChange={e => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            placeholder="Type a command, search a subtitle, or paste a timecode…"
            aria-label="Command or search"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 13,
            }}
          />
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)',
            border: '1px solid var(--border2)', borderRadius: 'var(--r-sm)', padding: '1px 5px',
          }}>
            esc
          </span>
        </div>

        <div ref={listRef} className="panel-body" style={{ padding: '5px 0 8px' }}>
          {items.length === 0 && (
            <div className="muted" style={{ padding: '14px 15px', fontSize: 'var(--fs-md)' }}>
              Nothing matches “{q}”.
            </div>
          )}
          {items.map((item, i) => {
            const header = item.section !== lastSection ? item.section : null
            lastSection = item.section
            return (
              <div key={item.key}>
                {header && (
                  <div className="caps" style={{ padding: '8px 15px 3px' }}>{header}</div>
                )}
                <div
                  data-row={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => item.run()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
                    padding: '6px 15px',
                    background: i === cursor ? 'var(--bg3)' : 'transparent',
                  }}
                >
                  <span style={{
                    fontSize: 'var(--fs-md)', color: 'var(--text)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {item.label}
                  </span>
                  {item.hint && (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)',
                      marginLeft: 'auto', flexShrink: 0,
                    }}>
                      {item.hint}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
