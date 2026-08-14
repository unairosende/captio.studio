import type { AnchorOp } from '../../types/comment.ts'
import { query, queryOne, requireOrg } from './client.ts'

export type { AnchorOp }

export interface CommentRow {
  id: string
  org_id: string
  project_id: string
  cue_index: number
  lang: string | null
  body: string
  author_id: string
  resolved: boolean
  created_at: string
}

/** A comment as the editor shows it: the author is a person, not an id. */
export interface CommentWithAuthor extends CommentRow {
  author_name: string | null
}

/**
 * Every comment on a project, oldest first within each cue.
 *
 * The author is joined in rather than looked up by the caller: a thread of six
 * notes would otherwise be six queries, and printing `user_01H9…` over somebody's
 * note is no better than printing nothing.
 */
export async function listComments(
  orgId: string,
  projectId: string,
): Promise<CommentWithAuthor[]> {
  return query<CommentWithAuthor>(
    `select c.*, u."name" as author_name
       from comments c
       left join "user" u on u."id" = c.author_id
      where c.org_id = $1 and c.project_id = $2
      order by c.cue_index, c.created_at`,
    [requireOrg(orgId), projectId],
  )
}

export async function createComment(
  orgId: string,
  input: {
    projectId: string
    cueIndex: number
    lang?: string | null
    body: string
    authorId: string
  },
): Promise<CommentRow> {
  const rows = await query<CommentRow>(
    `insert into comments (org_id, project_id, cue_index, lang, body, author_id)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      requireOrg(orgId),
      input.projectId,
      input.cueIndex,
      input.lang ?? null,
      input.body,
      input.authorId,
    ],
  )
  return rows[0]
}

export async function setCommentResolved(
  orgId: string,
  id: string,
  resolved: boolean,
): Promise<CommentRow | null> {
  return queryOne<CommentRow>(
    `update comments set resolved = $3 where org_id = $1 and id = $2 returning *`,
    [requireOrg(orgId), id, resolved],
  )
}

/** Only the author may delete their own comment; org scope alone is not enough. */
export async function deleteComment(
  orgId: string,
  id: string,
  authorId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from comments where org_id = $1 and id = $2 and author_id = $3 returning id`,
    [requireOrg(orgId), id, authorId],
  )
  return rows.length > 0
}

// ── Anchors ────────────────────────────────────────────────────────────────

/** Accepts the transaction-scoped runner so anchors move with the cues or not at all. */
type Run = typeof query

export async function shiftCommentAnchors(
  orgId: string,
  projectId: string,
  fromIndex: number,
  delta: number,
  run: Run = query,
): Promise<number> {
  const rows = await run<{ id: string }>(
    `update comments set cue_index = cue_index + $4
      where org_id = $1 and project_id = $2 and cue_index >= $3
      returning id`,
    [requireOrg(orgId), projectId, fromIndex, delta],
  )
  return rows.length
}

export async function dropCommentsForCue(
  orgId: string,
  projectId: string,
  cueIndex: number,
  run: Run = query,
): Promise<number> {
  const rows = await run<{ id: string }>(
    `delete from comments where org_id = $1 and project_id = $2 and cue_index = $3 returning id`,
    [requireOrg(orgId), projectId, cueIndex],
  )
  return rows.length
}

/**
 * Replay the editor's structural edits over the anchors, in the order they happened.
 *
 * ponytail: deleting a cue takes its comments with it, and undoing the delete does
 * not bring them back — the rows are gone by the time the undo is saved. Restoring
 * them would mean keeping tombstones; worth it only once somebody complains.
 */
export async function applyAnchorOps(
  orgId: string,
  projectId: string,
  ops: AnchorOp[],
  run: Run = query,
): Promise<void> {
  for (const op of ops) {
    if (op.dropIndex !== undefined) {
      await dropCommentsForCue(orgId, projectId, op.dropIndex, run)
    }
    if (op.delta !== 0) {
      await shiftCommentAnchors(orgId, projectId, op.fromIndex, op.delta, run)
    }
  }
}

/** Reject anything that is not a shift the editor could have produced. */
export function parseAnchorOps(value: unknown): AnchorOp[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): AnchorOp[] => {
    if (!raw || typeof raw !== 'object') return []
    const { dropIndex, fromIndex, delta } = raw as Record<string, unknown>
    if (!Number.isInteger(fromIndex) || !Number.isInteger(delta)) return []
    // A cue moves by one place at a time; anything larger is not an edit the
    // editor makes, and a stray thousand would scatter a project's notes.
    if (Math.abs(delta as number) !== 1) return []
    return [{
      ...(Number.isInteger(dropIndex) ? { dropIndex: dropIndex as number } : {}),
      fromIndex: fromIndex as number,
      delta: delta as number,
    }]
  })
}
