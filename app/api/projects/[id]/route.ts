import { NextResponse, type NextRequest } from 'next/server'

import type { GlossaryEntry } from '@/lib/ai/prompt'
import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { isUuid } from '@/lib/db/client'
import { getClient } from '@/lib/db/clients'
import { deleteProject, getProject, updateProject } from '@/lib/db/projects'
import { listSequences } from '@/lib/db/sequences'
import { addVariant } from '@/lib/subtitles'

import { MAX_NAME, parseGlossary, parseVariant } from '../route'

/** Declined suggestions kept per project. Far more than anybody will decline. */
const MAX_DISMISSED = 500

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

  let glossary: GlossaryEntry[] | undefined
  if (body?.glossary !== undefined) {
    const parsed = parseGlossary(body.glossary)
    if (!parsed) {
      return NextResponse.json({ error: 'glossary is malformed' }, { status: 400 })
    }
    glossary = parsed
  }

  // null unassigns. An id is looked up first so that one from another
  // organisation is refused out loud rather than quietly leaving it unassigned.
  let clientId: string | null | undefined
  if (body?.clientId !== undefined) {
    if (body.clientId !== null && !isUuid(body.clientId)) {
      return NextResponse.json({ error: 'clientId is malformed' }, { status: 400 })
    }
    if (body.clientId && !(await getClient(ctx.orgId, body.clientId))) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }
    clientId = body.clientId
  }

  // A suggestion accepted or declined. Both read the row as it is now rather
  // than as the page last saw it, so a term a colleague added since is kept.
  const accepting = body?.addVariant !== undefined
  const declining = body?.dismissVariant !== undefined
  let dismissedVariants: string[] | undefined
  if (accepting || declining) {
    const current = await getProject(ctx.orgId, id)
    if (!current) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    if (accepting) {
      const pick = parseVariant(body.addVariant)
      if (!pick) return NextResponse.json({ error: 'addVariant is malformed' }, { status: 400 })
      const next = parseGlossary(addVariant(glossary ?? current.glossary, pick.term, pick.variant))
      if (!next) return NextResponse.json({ error: 'The glossary is full' }, { status: 400 })
      glossary = next
    }

    if (declining) {
      const key = body.dismissVariant
      if (typeof key !== 'string' || !key || key.length > MAX_NAME * 2 + 1) {
        return NextResponse.json({ error: 'dismissVariant is malformed' }, { status: 400 })
      }
      // The newest refusals are the ones worth keeping if the list ever fills.
      dismissedVariants = [...new Set([...current.dismissed_variants, key])].slice(-MAX_DISMISSED)
    }
  }

  const project = await updateProject(ctx.orgId, id, { name, glossary, clientId, dismissedVariants })
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
