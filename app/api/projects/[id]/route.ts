import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { deleteProject, getProject, updateProject } from '@/lib/db/projects'
import { listSequences } from '@/lib/db/sequences'

import { MAX_NAME, parseGlossary } from '../route'

/**
 * One project: what is in it, what it is called, and the terms it agrees on.
 *
 * Scoped by organisation, so somebody else's project is not found rather than
 * forbidden — a 403 would confirm the id exists.
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

  const { id } = await params
  const project = await getProject(ctx.orgId, id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Both, because there is no reason to open a project except to see what is in
  // it, and asking twice would draw the page in two stages for no benefit.
  return NextResponse.json({ project, sequences: await listSequences(ctx.orgId, id) })
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

  let name: string | undefined
  if (body?.name !== undefined) {
    name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > MAX_NAME) {
      return NextResponse.json({ error: 'A name is required' }, { status: 400 })
    }
  }

  let glossary: { term: string; translation?: string }[] | undefined
  if (body?.glossary !== undefined) {
    const parsed = parseGlossary(body.glossary)
    if (!parsed) {
      return NextResponse.json({ error: 'glossary is malformed' }, { status: 400 })
    }
    glossary = parsed
  }

  const project = await updateProject(ctx.orgId, id, { name, glossary })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json({ project })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Everything inside goes too — see lib/db/projects.ts. The count is reported
  // so the caller can say what it is about to destroy rather than "are you
  // sure?", which is a question nobody has the information to answer.
  const gone = await deleteProject(ctx.orgId, (await params).id)
  if (!gone) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
