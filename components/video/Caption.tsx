/**
 * The cue under the picture.
 *
 * Absolutely positioned inside whatever holds the <video> — a `.picture` — so
 * both the editor's pane and the client's viewer get the same line in the
 * same place. How it looks is the `.caption` piece in ui.css.
 */
export default function Caption({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return <div className="caption" aria-live="off">{text}</div>
}
