'use client'

import type { ReviewNote } from '@/lib/ai/prompt'

/**
 * What the review pass found, as a list to read once.
 *
 * A list rather than a badge on every card, because that is how a reviewer's
 * notes are used: read the four things that are wrong, then go and fix them.
 * Spread across a hundred cards they would have to be hunted for, and the
 * three that matter would sit at the same weight as the one that does not.
 *
 * Kept out of the cards for a second reason. The quality check measures — a
 * line is 45 characters or it is not — and this is a model's opinion, right
 * most of the time. Printed in the same list, in the same colours, the two
 * would be indistinguishable, and the measured ones would start to look like
 * opinions too.
 */
export default function ReviewNotes({
  notes,
  lang,
  filtered,
  onToggleFilter,
  onClear,
}: {
  notes: ReviewNote[]
  lang: string
  /** Whether the editor is currently narrowed to the cues these notes name. */
  filtered: boolean
  onToggleFilter: () => void
  onClear: () => void
}) {
  return (
    <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0, maxHeight: 190, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px 5px' }}>
        <span className="caps">Review · {lang}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
        {notes.length > 0 && (
          <button className="btn" onClick={onToggleFilter} style={{ marginLeft: 'auto' }}>
            {filtered ? 'Show all subtitles' : 'Show only these'}
          </button>
        )}
        <button className="btn" onClick={onClear} style={notes.length ? undefined : { marginLeft: 'auto' }}>
          Dismiss
        </button>
      </div>

      {/* An empty review is a result, not a missing panel. Somebody who ran the
          pass on clean work has to be told it ran. */}
      {notes.length === 0 && (
        <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--text3)' }}>
          Nothing to report — nothing here contradicts the source.
        </div>
      )}

      <div style={{ overflowY: 'auto', padding: '0 14px 9px' }}>
        {notes.map(n => (
          <div key={n.cue} style={{ display: 'flex', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 12, lineHeight: 1.45 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: n.level === 'error' ? 'var(--red)' : 'var(--amber)', flexShrink: 0, paddingTop: 1 }}>
              #{n.cue}
            </span>
            <span style={{ color: 'var(--text2)' }}>{n.note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
