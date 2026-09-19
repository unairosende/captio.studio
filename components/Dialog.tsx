'use client'

import { type CSSProperties, type ReactNode, useEffect } from 'react'

import { useRestoreFocus } from '@/components/useRestoreFocus'

/**
 * A dialog: the scrim, the panel, and the two ways out.
 *
 * Esc closes it from anywhere on the page, a click on the scrim closes it,
 * and when it goes the focus returns to whatever had it before. Three
 * dialogs each carried their own copy of those twelve lines; the fourth
 * would have carried a slightly different one.
 *
 * The panel's size is the piece's parameter — `--panel-w`, `--panel-h` in
 * ui.css — so a dialog says how big it is and nothing about how it looks.
 */
export default function Dialog({ label, width, height, className = '', onClose, children }: {
  label: string
  width?: string
  height?: string
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  useRestoreFocus()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`panel ${className}`} style={{ '--panel-w': width, '--panel-h': height } as CSSProperties}>
        {children}
      </div>
    </div>
  )
}
