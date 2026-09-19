'use client'

import { useEffect } from 'react'

import { useRestoreFocus } from '@/components/useRestoreFocus'
import { SHORTCUTS } from '@/lib/shortcuts'

import s from './editor.module.css'

/**
 * The keyboard map, inside the app.
 *
 * A subtitler does not let go of the keyboard, and a shortcut that cannot be
 * looked up is a shortcut that does not exist. ⌘/ opens it, the account menu
 * names it, and the palette lists it — the three ways everything else in the
 * editor is reached.
 */
export default function Shortcuts({ onClose }: { onClose: () => void }) {
  useRestoreFocus()
  useEffect(() => {

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Atajos de teclado" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`panel ${s.keys}`}>
        <div className="panel-head">
          <span className="panel-title">Atajos de teclado</span>
          <span className="muted">⌘ es Ctrl en Windows y Linux</span>
          <button className="btn btn-quiet btn-icon panel-close" onClick={onClose} aria-label="Cerrar los atajos" autoFocus>×</button>
        </div>
        <div className="panel-body">
          {SHORTCUTS.map(group => (
            <section key={group.title} className={s.keyGroup}>
              <span className="caps">{group.title}</span>
              {group.items.map(item => (
                <div key={item.keys} className="row">
                  <span>{item.does}</span>
                  <span className="kbd">{item.keys}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
