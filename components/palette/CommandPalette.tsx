'use client'

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useRestoreFocus } from '@/components/useRestoreFocus'
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
  useRestoreFocus()

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
        section: 'Acciones',
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
        label: `Ir al cue ${destination.index}`,
        hint: exists ? undefined : 'no existe',
        section: 'Ir a',
        run: () => { if (exists) jumpToCue(destination.index); onClose() },
      })
    }
    if (destination?.kind === 'time') {
      out.push({
        key: 'goto-time',
        label: `Ir a ${q.trim()}`,
        section: 'Ir a',
        run: () => {
          // Says so rather than doing nothing: with no audio loaded there is no
          // timeline listening, and a silent no-op reads as a broken palette.
          if (!seekTo(destination.seconds)) alert('Carga antes el audio de la secuencia')
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
      const label = `Ver ${tab === 'source' ? 'el original' : tab}`
      if (needle && !fold(label).includes(needle)) continue
      out.push({
        key: `tab-${tab}`,
        label,
        section: 'Acciones',
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
          section: 'Cues',
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
      aria-label="Paleta de comandos"
    >
      {/* The piece the style guide shows, and nothing drawn here: the field,
          the list in groups, the empty answer and the foot with the keys. */}
      <div className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          // The cursor goes back to the top here rather than in an effect
          // watching `q`: a filtered list is a different list, and leaving the
          // cursor on row six of a list that now has two would run whatever
          // happens to be sitting there.
          onChange={e => { setQ(e.target.value); setCursor(0) }}
          onKeyDown={onKeyDown}
          placeholder="Cue, timecode o acción…"
          aria-label="Acción o búsqueda"
          autoComplete="off"
          spellCheck={false}
        />

        <div ref={listRef} className="palette-list">
          {items.length === 0 && <div className="palette-empty">Nada para «{q}».</div>}
          {items.map((item, i) => {
            const header = item.section !== lastSection ? item.section : null
            lastSection = item.section
            return (
              <div key={item.key}>
                {header && <span className="caps palette-group">{header}</span>}
                <div
                  className="palette-item"
                  data-row={i}
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => item.run()}
                >
                  <span className="palette-label">{item.label}</span>
                  {/* A cue's position reads beside its text; an action's key
                      sits at the far end, as the style guide has them. */}
                  {item.hint && (item.section === 'Cues'
                    ? <span className="muted">{item.hint}</span>
                    : <span className="kbd">{item.hint}</span>)}
                </div>
              </div>
            )
          })}
        </div>

        <div className="palette-foot"><span>↑↓ moverse</span><span>⏎ ejecutar</span><span>esc cerrar</span></div>
      </div>
    </div>
  )
}
