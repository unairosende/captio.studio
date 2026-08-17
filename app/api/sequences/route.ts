import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import {
  UnknownProjectError,
  createSequence,
  listAllSequences,
  listSequences,
} from '@/lib/db/sequences'

/**
 * The subtitle tracks themselves.
 *
 * A sequence always belongs to a project, so creating one names its project.
 * That project is checked against the caller's organisation inside the INSERT —
 * a foreign key would prove the id exists, not that it is theirs.
 */

/** Long enough for a real title, short enough not to be a paste. */
const MAX_NAME = 200

/**
 * `GET /api/sequences?project=<id>` for one project's tracks, or without the
 * parameter for everything the organisation has, newest first.
 */
export async function GET(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const projectId = req.nextUrl.searchParams.get('project')

  // Summaries, not cues. A list of twenty sequences should not ship twenty
  // subtitle tracks in order to draw a menu.
  const sequences = projectId
    ? await listSequences(ctx.orgId, projectId)
    : await listAllSequences(ctx.orgId)

  return NextResponse.json({ sequences })
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''

  if (!name || name.length > MAX_NAME) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  }
  if (!projectId) {
    return NextResponse.json({ error: 'A projectId is required' }, { status: 400 })
  }
  if (body?.data !== undefined && (typeof body.data !== 'object' || body.data === null)) {
    return NextResponse.json({ error: 'data must be an object' }, { status: 400 })
  }

  try {
    // The whole track travels as one JSON body, which the platform caps at a few
    // megabytes — a feature in three languages before it bites. Past that,
    // sequences follow media into object storage rather than growing a chunked
    // save nobody has needed yet.
    const sequence = await createSequence(ctx.orgId, {
      projectId,
      name,
      sourceLang: typeof body?.sourceLang === 'string' ? body.sourceLang : null,
      targetLangs: Array.isArray(body?.targetLangs)
        ? body.targetLangs.filter((l: unknown) => typeof l === 'string')
        : [],
      fps: typeof body?.fps === 'number' ? body.fps : undefined,
      data: body?.data ?? {},
      createdBy: ctx.userId,
    })

    return NextResponse.json({ sequence }, { status: 201 })
  } catch (err) {
    // Deliberately the same 404 an unknown id gets: whether a project belongs to
    // another organisation is not something this route will confirm.
    if (err instanceof UnknownProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
