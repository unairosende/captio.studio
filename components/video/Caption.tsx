/**
 * The cue under the picture.
 *
 * Absolutely positioned inside whatever holds the <video>, so both the editor's
 * pane and the client's viewer get the same line in the same place: bottom
 * centre, white on a shadow, as a broadcast would burn it in. Not styled from
 * the theme on purpose — a subtitle over footage is read against the footage,
 * not against the app.
 */
export default function Caption({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return (
    <div
      aria-live="off"
      style={{
        position: 'absolute', left: '4%', right: '4%', bottom: '6%',
        textAlign: 'center', pointerEvents: 'none',
        color: '#fff', fontSize: 'clamp(12px, 2.4cqw, 22px)', lineHeight: 1.3, fontWeight: 500,
        textShadow: '0 0 4px #000, 0 1px 2px #000, 0 0 12px rgba(0,0,0,.8)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {text}
    </div>
  )
}
