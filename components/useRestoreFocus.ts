'use client'

import { useEffect } from 'react'

/**
 * Give the focus back when this closes.
 *
 * A dialog or a menu takes the focus when it opens; when it goes, the
 * browser drops it on the body, and the next Tab starts from the top of the
 * page. Remembering where it was is what lets ⌘K, ⌘/, a thread or the row's
 * menu be opened and closed without losing the place in the table.
 *
 * "Where it was" is the last thing focused outside any floating layer, kept
 * by one listener for the whole page: a dialog opened from the palette
 * mounts after the palette has gone, and asking the document at that moment
 * would answer with the dialog's own close button.
 */

let last: HTMLElement | null = null

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement | null
    if (el && !el.closest('.overlay, .menu')) last = el
  })
}

export function useRestoreFocus() {
  useEffect(() => {
    const before = last
    // Only when the focus was actually dropped: a dialog that opened another
    // has already handed it on, and taking it back would leave the new one.
    return () => { if (document.activeElement === document.body) before?.focus?.() }
  }, [])
}
