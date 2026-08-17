import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { createProject, listProjects } from '@/lib/db/projects'

/**
 * The jobs an organisation has on.
 *
 * A project holds sequences — a feature and its reels, a series and its
 * episodes. Until migration 0007 this route returned the tracks themselves;
 * those now live under /api/sequences, and what comes back here is the grouping.
 */

/** Long enough for a real title, short enough not to be a paste. */
export const MAX_NAME = 200

/**
 * Sized for terminology, not for a translation memory.
 *
 * The glossary goes into every prompt this project ever sends, so a thousand
 * terms would not be a richer glossary — it would be a bill, on every batch, for
 * context the model mostly ignores.
 */
export const MAX_GLOSSARY = 200

/**
 * Accept only the shape lib/ai/prompt.ts knows how to turn into a prompt.
 *
 * Returns null for anything malformed and an array otherwise — including the
 * empty array, so callers must test for null rather than for falsiness.
 */
export function parseGlossary(value: unknown): { term: string; translation?: string }[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_GLOSSARY) return null

  const entries: { term: string; translation?: string }[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const { term, translation } = raw as Record<string, unknown>
    if (typeof term !== 'string' || term.length > MAX_NAME) return null
    if (translation !== undefined && translation !== null && typeof translation !== 'string') {
      return null
    }
    // Blank rows are what the panel leaves behind when somebody adds a line and
    // then changes their mind. Dropping them here keeps them out of every prompt.
    if (!term.trim()) continue
    entries.push({ term, ...(translation ? { translation: translation as string } : {}) })
  }
  return entries
}

export async function GET() {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

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

  const glossary = parseGlossary(body?.glossary)
  if (!glossary) {
    return NextResponse.json(
      { error: `glossary must be up to ${MAX_GLOSSARY} { term, translation } entries` },
      { status: 400 },
    )
  }

  const project = await createProject(ctx.orgId, { name, glossary, createdBy: ctx.userId })

  return NextResponse.json({ project }, { status: 201 })
}
