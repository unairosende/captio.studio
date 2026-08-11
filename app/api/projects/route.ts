import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createProject, listProjects } from '@/lib/db/projects'

/**
 * The projects an organisation has.
 *
 * Work currently lives in the browser and dies with the tab, which is the first
 * thing anybody will report. Everything underneath — the table, the version
 * counter, the organisation scoping — has been in place since the data layer
 * was written. This is the door.
 */

/** Long enough for a real title, short enough not to be a paste. */
const MAX_NAME = 200

export async function GET() {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Summaries, not cues. A list of twenty projects should not ship twenty
  // subtitle tracks in order to draw a menu.
  return NextResponse.json({ projects: await listProjects(ctx.orgId) })
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

  if (!name || name.length > MAX_NAME) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  }
  if (body?.data !== undefined && (typeof body.data !== 'object' || body.data === null)) {
    return NextResponse.json({ error: 'data must be an object' }, { status: 400 })
  }

  // The whole track travels as one JSON body, which the platform caps at a few
  // megabytes — a feature in three languages before it bites. Past that,
  // projects follow media into object storage rather than growing a chunked
  // save nobody has needed yet.
  const project = await createProject(ctx.orgId, {
    name,
    sourceLang: typeof body?.sourceLang === 'string' ? body.sourceLang : null,
    targetLangs: Array.isArray(body?.targetLangs)
      ? body.targetLangs.filter((l: unknown) => typeof l === 'string')
      : [],
    fps: typeof body?.fps === 'number' ? body.fps : undefined,
    data: body?.data ?? {},
  })

  return NextResponse.json({ project }, { status: 201 })
}
