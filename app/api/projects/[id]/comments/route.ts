import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createComment, listComments } from '@/lib/db/comments'
import { getProject } from '@/lib/db/projects'

/**
 * The notes on one project.
 *
 * A comment belongs to a cue number rather than to a piece of text, because the
 * text is the thing being argued about — "this line is too literal" has to
 * survive the line being rewritten.
 *
 * Both handlers are scoped by organisation, and POST checks the project exists
 * within it before writing. Without that check a caller could hang comments off
 * another customer's project id: the row would carry their own org_id, so
 * nobody would ever see it, but the write would succeed and the foreign key
 * would point across the tenant boundary.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** Long enough for a paragraph of direction, short enough not to be a document. */
const MAX_BODY = 2000

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const comments = await listComments(ctx.orgId, (await params).id)
  return NextResponse.json({ comments })
}

export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const payload = await req.json().catch(() => null)

  const text = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'A comment needs something in it' }, { status: 400 })
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: `Keep it under ${MAX_BODY} characters` }, { status: 400 })
  }
  if (!Number.isInteger(payload?.cueIndex)) {
    return NextResponse.json({ error: 'Which subtitle?' }, { status: 400 })
  }

  if (!(await getProject(ctx.orgId, id))) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  await createComment(ctx.orgId, {
    projectId: id,
    cueIndex: payload.cueIndex,
    lang: typeof payload?.lang === 'string' ? payload.lang : null,
    body: text,
    authorId: ctx.userId,
  })

  // The whole thread back, rather than the one row: the insert does not know the
  // author's name, and the caller would have to ask for it anyway.
  return NextResponse.json({ comments: await listComments(ctx.orgId, id) }, { status: 201 })
}
