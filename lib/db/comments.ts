import { query, queryOne, requireOrg } from './client.ts'

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

export async function listComments(orgId: string, projectId: string): Promise<CommentRow[]> {
  return query<CommentRow>(
    `select * from comments
      where org_id = $1 and project_id = $2
      order by cue_index, created_at`,
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

/**
 * Shift comment anchors after cues are inserted or removed.
 *
 * Comments point at `cue_index`, and cues live inside `projects.data`, so
 * renumbering the track silently moves every comment onto the wrong line unless
 * this runs in the same transaction as the renumber.
 */
export async function shiftCommentAnchors(
  orgId: string,
  projectId: string,
  fromIndex: number,
  delta: number,
): Promise<number> {
  const rows = await query<{ id: string }>(
    `update comments set cue_index = cue_index + $4
      where org_id = $1 and project_id = $2 and cue_index >= $3
      returning id`,
    [requireOrg(orgId), projectId, fromIndex, delta],
  )
  return rows.length
}
