import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { deleteComment, setCommentResolved } from '@/lib/db/comments'

/**
 * One comment: settle it, or take it back.
 *
 * Resolving is open to anyone in the organisation — a note is resolved when the
 * work is done, and the person who did the work is rarely the one who asked for
 * it. Deleting is not: `deleteComment` matches on the author as well as the
 * organisation, so a colleague can close your note but cannot erase it.
 */

interface Params {
  params: Promise<{ id: string; commentId: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { commentId } = await params
  const payload = await req.json().catch(() => null)
  if (typeof payload?.resolved !== 'boolean') {
    return NextResponse.json({ error: 'Resolved or not?' }, { status: 400 })
  }

  const comment = await setCommentResolved(ctx.orgId, commentId, payload.resolved)
  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  return NextResponse.json({ comment })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { commentId } = await params
  // 404 rather than 403 when it belongs to somebody else: the two cases differ
  // only by who wrote it, and saying which would confirm the comment exists.
  const gone = await deleteComment(ctx.orgId, commentId, ctx.userId)
  if (!gone) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
