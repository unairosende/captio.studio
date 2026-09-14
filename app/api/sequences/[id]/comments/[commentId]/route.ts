import { NextResponse, type NextRequest } from 'next/server'

import { requireActor } from '@/lib/auth/actor'
import { authErrorResponse } from '@/lib/auth/session'
import { deleteComment, setCommentResolved } from '@/lib/db/comments'

/**
 * One comment: settle it, or take it back.
 *
 * Resolving is open to anyone who can see the sequence — a note is resolved
 * when the work is done, and the person who did the work is rarely the one who
 * asked for it. Deleting is not: `deleteComment` matches on the author as well,
 * so a colleague or a client can close your note but cannot erase it.
 *
 * Both mutations are scoped by the sequence in the URL as well as by the
 * organisation. A guest holds one project, and this is what keeps a guessed
 * comment id from another project of the same productora out of reach.
 */

interface Params {
  params: Promise<{ id: string; commentId: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, commentId } = await params
  let actor
  try {
    actor = await requireActor(req, id)
  } catch (err) {
    return authErrorResponse(err)
  }

  const payload = await req.json().catch(() => null)
  if (typeof payload?.resolved !== 'boolean') {
    return NextResponse.json({ error: 'Resolved or not?' }, { status: 400 })
  }

  const comment = await setCommentResolved(actor.orgId, id, commentId, payload.resolved)
  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  return NextResponse.json({ comment })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, commentId } = await params
  let actor
  try {
    actor = await requireActor(req, id)
  } catch (err) {
    return authErrorResponse(err)
  }

  // 404 rather than 403 when it belongs to somebody else: the two cases differ
  // only by who wrote it, and saying which would confirm the comment exists.
  const gone = await deleteComment(
    actor.orgId,
    id,
    commentId,
    actor.kind === 'user' ? { userId: actor.userId } : { guestId: actor.guestId },
  )
  if (!gone) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
