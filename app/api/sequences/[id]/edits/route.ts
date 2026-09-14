import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { ConflictError, getSequence, saveTextEdits } from '@/lib/db/sequences'
import { UnknownCueError, type TextEdit } from '@/lib/subtitles/data'

/**
 * Rewrite the text of some cues.
 *
 * The review view saves through here rather than through PATCH: a PATCH carries
 * the whole blob, and whoever sends it decides the shape of the track. This
 * route takes lines — a language, a number, new words — and the shape cannot
 * change, whoever is asking. That is what makes it safe to hand to a client.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** Enough for one sitting's corrections; far more is a bug or an attack. */
const MAX_EDITS = 500
/** A subtitle is two lines of forty-odd characters. This is a paragraph. */
const MAX_TEXT = 1000

function parseEdits(value: unknown): TextEdit[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_EDITS) return null
  const out: TextEdit[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const { lang, index, text } = raw as Record<string, unknown>
    if (typeof lang !== 'string' || !lang) return null
    if (!Number.isInteger(index)) return null
    if (typeof text !== 'string' || text.length > MAX_TEXT) return null
    out.push({ lang, index: index as number, text })
  }
  return out
}

export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const body = await req.json().catch(() => null)

  const edits = parseEdits(body?.edits)
  if (!edits) return NextResponse.json({ error: 'Which subtitles, and what should they say?' }, { status: 400 })

  try {
    const sequence = await saveTextEdits(ctx.orgId, id, edits, {
      expectedVersion: typeof body?.version === 'number' ? body.version : undefined,
      createdBy: ctx.userId,
      note: typeof body?.note === 'string' ? body.note.trim().slice(0, 200) || null : null,
    })
    if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })

    return NextResponse.json({ sequence })
  } catch (err) {
    if (err instanceof UnknownCueError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof ConflictError) {
      // The same answer PATCH gives: the current row, so the caller can reload
      // rather than guess what changed underneath them.
      return NextResponse.json(
        { error: err.message, sequence: await getSequence(ctx.orgId, id) },
        { status: 409 },
      )
    }
    throw err
  }
}
