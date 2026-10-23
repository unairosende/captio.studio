import { NextResponse, type NextRequest } from 'next/server'

import { MAX_NAME, parseGlossary } from '@/app/api/projects/route'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { isUuid } from '@/lib/db/client'
import { updateClient } from '@/lib/db/clients'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * Rename a client, or replace the glossary every one of its projects inherits.
 *
 * Scoped by organisation, so somebody else's client is not found rather than
 * forbidden — the difference would confirm the id exists.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
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

  const client = await updateClient(ctx.orgId, id, { name, glossary })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  return NextResponse.json({ client })
}
