import { NextResponse, type NextRequest } from 'next/server'

import { MAX_NAME } from '@/app/api/projects/route'
import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createClient } from '@/lib/db/clients'

/**
 * Name a client, so projects can be filed under it and share its terms.
 *
 * Created empty and named once: the glossary is filled in afterwards, from the
 * project page, by whoever knows how the client spells things.
 */
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

  const client = await createClient(ctx.orgId, { name, createdBy: ctx.userId })
  return NextResponse.json({ client }, { status: 201 })
}
