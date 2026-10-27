/**
 * The editor's icons: a rail of steps and sections, three sides that fold, a
 * viewer that shrinks and fills, a menu that drops. Drawn here rather than
 * pulled from a library because there are fifteen of them, one weight, one
 * size, and a library would bring six hundred more with their own idea of a
 * stroke.
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

/** An eye: the translation, read against the original. */
export const ReviewIcon = () => (
  <Svg><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></Svg>
)

/** Layers: a correction applied to every cue at once. */
export const BatchIcon = () => (
  <Svg><path d="M8 1.5 1.5 5 8 8.5 14.5 5z" /><path d="M1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11" /></Svg>
)

/** Two sliders: the sequence's settings and the glossary. */
export const PropsIcon = () => (
  <Svg><path d="M2 4.5h1.75M7.25 4.5H14M2 11.5h6.75M12.25 11.5H14" /><circle cx="5.5" cy="4.5" r="1.75" /><circle cx="10.5" cy="11.5" r="1.75" /></Svg>
)

/** A speech bubble: the comments. */
export const CommentIcon = () => (
  <Svg><path d="M2.5 3h11v7.5H7.5L4.5 13v-2.5h-2z" /></Svg>
)

/** A pane with its left third marked: the sidebar. */
export const PanelLeftIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 3v10" /></Svg>
)

/** A pane with its right third marked: the panel. */
export const PanelRightIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M10 3v10" /></Svg>
)

/** A pane with its bottom third marked: the wave. */
export const PanelBottomIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 9.5h12" /></Svg>
)

/** A frame with a small one in its corner: the viewer, floating. */
export const MinimizeIcon = () => (
  <Svg><rect x="2" y="3" width="12" height="10" rx="1.5" /><rect x="8.5" y="8.5" width="3.5" height="2.5" rx=".5" /></Svg>
)

/** Six dots: what is held to carry the floating viewer. */
export const GripIcon = () => (
  <Svg strokeWidth="2.25"><path d="M6 4h0M10 4h0M6 8h0M10 8h0M6 12h0M10 12h0" /></Svg>
)

/** Corners pulled outwards: the viewer, filling the work area. */
export const MaximizeIcon = () => (
  <Svg><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.5 6.5M2.5 13.5l4-4" /></Svg>
)

/** Corners pushed back in: the viewer, back to its place. */
export const RestoreIcon = () => (
  <Svg><path d="M13.5 2.5l-4 4M9.5 3v3.5H13M2.5 13.5l4-4M3 9.5h3.5V13" /></Svg>
)

/** Down: a menu hangs from here. */
export const ChevronIcon = () => (
  <Svg width="12" height="12"><path d="M4 6l4 4 4-4" /></Svg>
)
