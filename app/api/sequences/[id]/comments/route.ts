import { NextResponse, type NextRequest } from 'next/server'

import { requireActor } from '@/lib/auth/actor'
import { authErrorResponse } from '@/lib/auth/session'
import { createComment, listComments } from '@/lib/db/comments'
import { getProject } from '@/lib/db/projects'
import { getSequenceSummary } from '@/lib/db/sequences'
import { notifyComment } from '@/lib/review/notify'

/**
 * The notes on one sequence.
 *
 * A comment belongs to a cue number rather than to a piece of text, because the
 * text is the thing being argued about — "this line is too literal" has to
 * survive the line being rewritten.
 *
 * Open to guests: a client holding a review link reads and writes here with the
 * token in a header instead of a session. `requireActor` resolves either kind
 * of caller to an organisation on the server and verifies the sequence is one
 * they may see — so a comment can never be hung off another customer's
 * sequence, nor off another project of the same productora.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** Long enough for a paragraph of direction, short enough not to be a document. */
const MAX_BODY = 2000

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  let actor
  try {
    actor = await requireActor(req, id)
  } catch (err) {
    return authErrorResponse(err)
  }

  const comments = await listComments(actor.orgId, id)
  return NextResponse.json({ comments })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  let actor
  try {
    actor = await requireActor(req, id)
  } catch (err) {
    return authErrorResponse(err)
  }

  const payload = await req.json().catch(() => null)

  const text = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'A comment needs something in it' }, { status: 400 })
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: `Keep it under ${MAX_BODY} characters` }, { status: 400 })
  }
  if (!Number.isInteger(payload?.cueIndex)) {
    return NextResponse.json({ error: 'Which subtitle?' }, { status: 400 })
  }

  const comment = await createComment(actor.orgId, {
    sequenceId: id,
    cueIndex: payload.cueIndex,
    lang: typeof payload?.lang === 'string' ? payload.lang : null,
    body: text,
    // Signed by whoever is here: a member by user id, a client by guest id.
    authorId: actor.kind === 'user' ? actor.userId : null,
    guestId: actor.kind === 'guest' ? actor.guestId : null,
  })

  // The whole thread back, rather than the one row: the insert does not know the
  // author's name, and the caller would have to ask for it anyway.
  const comments = await listComments(actor.orgId, id)

  // Tell the rest of the conversation. Awaited, because on this platform work
  // left running after the response may simply not happen; it never throws.
  const sequence = await getSequenceSummary(actor.orgId, id)
  if (sequence) {
    const project = await getProject(actor.orgId, sequence.project_id)
    await notifyComment({
      actor,
      authorName:
        comments.find(c => c.id === comment.id)?.author_name ??
        (actor.kind === 'guest' ? actor.name : 'Someone'),
      comment,
      sequence: { id: sequence.id, name: sequence.name },
      projectName: project?.name ?? '',
    })
  }

  return NextResponse.json({ comments }, { status: 201 })
}
