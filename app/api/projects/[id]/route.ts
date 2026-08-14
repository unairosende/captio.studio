import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { parseAnchorOps } from '@/lib/db/comments'
import { ConflictError, deleteProject, getProject, updateProject } from '@/lib/db/projects'

/**
 * One project: read it, save over it, throw it away.
 *
 * Every query is scoped by organisation, so a project belonging to somebody
 * else is not found rather than forbidden. The distinction matters: a 403 would
 * confirm the id exists, turning this route into a way to enumerate other
 * customers' work.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const project = await getProject(ctx.orgId, (await params).id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json({ project })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const body = await req.json().catch(() => null)

  try {
    const project = await updateProject(
      ctx.orgId,
      id,
      {
        name: typeof body?.name === 'string' ? body.name.trim() : undefined,
        sourceLang: typeof body?.sourceLang === 'string' ? body.sourceLang : undefined,
        targetLangs: Array.isArray(body?.targetLangs) ? body.targetLangs : undefined,
        fps: typeof body?.fps === 'number' ? body.fps : undefined,
        data: body?.data,
      },
      {
        // Sent by the editor, which knows which version it opened. Absent means
        // "save regardless" — right for a rename, wrong for cues.
        expectedVersion: typeof body?.version === 'number' ? body.version : undefined,
        // The splits and deletions this save carries, so the comments move with
        // the cues they are about instead of staying on the old numbers.
        anchorOps: parseAnchorOps(body?.anchorOps),
      },
    )

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    return NextResponse.json({ project })
  } catch (err) {
    if (err instanceof ConflictError) {
      // 409 rather than a silent overwrite. Two people editing the same
      // subtitles is ordinary in a production company, and whoever saves second
      // should be told rather than quietly winning.
      return NextResponse.json(
        { error: err.message, project: await getProject(ctx.orgId, id) },
        { status: 409 },
      )
    }
    throw err
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const gone = await deleteProject(ctx.orgId, (await params).id)
  if (!gone) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
