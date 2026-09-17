/**
 * The editor's icons: a rail of steps, two panels that fold, a menu that
 * drops. Drawn here rather than pulled from a library because there are
 * seven of them, one weight, one size, and a library would bring six
 * hundred more with their own idea of a stroke.
 *
 * Every one is decorative: the button that carries it says its name.
 */

import type { SVGProps } from 'react'

function Svg({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

/** A document: what gets imported. */
export const FileIcon = () => (
  <Svg><path d="M4 1.5h5l3 3v10H4z" /><path d="M9 1.5v3h3" /><path d="M6 8.5h4M6 11h4" /></Svg>
)

/** A microphone: what gets transcribed. */
export const MicIcon = () => (
  <Svg><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" /></Svg>
)

/** Two scripts: what gets translated. */
export const TranslateIcon = () => (
  <Svg><path d="M2 3.5h7M5.5 1.5v2M8 3.5c-.5 3-2.5 5.5-5.5 7M4 6.5c.7 1.8 2.3 3.3 4.5 4.3" /><path d="M9 14.5l2.5-6 2.5 6M10 12.5h3" /></Svg>
)

/** An arrow into a tray: what gets delivered. */
export const DeliverIcon = () => (
  <Svg><path d="M8 1.5v8M5 6.5l3 3 3-3" /><path d="M2.5 11v3h11v-3" /></Svg>
)

/** A pane with its left third marked: the sidebar. */
export const PanelLeftIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 3v10" /></Svg>
)

/** A pane with its right third marked: the panel. */
export const PanelRightIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M10 3v10" /></Svg>
)

/** Down: a menu hangs from here. */
export const ChevronIcon = () => (
  <Svg width="12" height="12"><path d="M4 6l4 4 4-4" /></Svg>
)
