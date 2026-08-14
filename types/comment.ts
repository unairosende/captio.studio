/**
 * Comments, and the renumberings they have to survive.
 *
 * These live outside `lib/db` because the store needs them too, and `lib/db`
 * reaches for `pg` on import — which the browser bundle and `node --test` both
 * do without.
 */

/** A comment as the editor receives it. */
export interface ProjectComment {
  id: string
  cue_index: number
  lang: string | null
  body: string
  author_id: string
  author_name: string | null
  resolved: boolean
  /** ISO-8601, straight from `timestamptz`. */
  created_at: string
}

/**
 * One structural edit, described so the anchors can follow it.
 *
 * Comments point at a cue *number*, and cue numbers are positional: splitting
 * cue 7 makes a new cue 8 and pushes everything below it down one. Unless the
 * same save moves the anchors, every note under the edit ends up quoting a line
 * nobody wrote.
 */
export interface AnchorOp {
  /** Comments on this cue go with it. Set when a cue is deleted outright. */
  dropIndex?: number
  fromIndex: number
  delta: number
}

/** The shift and the shift that takes it back, recorded together so undo can replay it. */
export interface AnchorEdit {
  op: AnchorOp
  undo: AnchorOp
}

export const splitAnchors = (index: number): AnchorEdit => ({
  op:   { fromIndex: index + 1, delta:  1 },
  undo: { fromIndex: index + 1, delta: -1 },
})

/**
 * Deleting a cue takes its own notes with it.
 *
 * The undo shift puts the numbering back but not the notes: by the time an undo
 * reaches the database those rows are gone. Keeping them would mean tombstones,
 * which is a lot of machinery for a case that ends in "I meant to delete it".
 */
export const deleteAnchors = (index: number): AnchorEdit => ({
  op:   { dropIndex: index, fromIndex: index + 1, delta: -1 },
  undo: { fromIndex: index, delta: 1 },
})
