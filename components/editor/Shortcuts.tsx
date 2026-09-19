'use client'

import Dialog from '@/components/Dialog'
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
  return (
    <Dialog label="Atajos de teclado" className={s.keys} onClose={onClose}>
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
    </Dialog>
  )
}
