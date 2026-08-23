import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { parseAnchorOps } from '@/lib/db/comments'
import { markSequencePaid } from '@/lib/db/billing'
import { attachMedia } from '@/lib/db/media'
import { ConflictError, deleteSequence, getSequence, updateSequence } from '@/lib/db/sequences'

/**
 * One sequence: read it, save over it, throw it away.
 *
 * Every query is scoped by organisation, so a sequence belonging to somebody
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

  const sequence = await getSequence(ctx.orgId, (await params).id)
  if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })

  return NextResponse.json({ sequence })
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
    const sequence = await updateSequence(
      ctx.orgId,
      id,
      {
        name: typeof body?.name === 'string' ? body.name.trim() : undefined,
        sourceLang: typeof body?.sourceLang === 'string' ? body.sourceLang : undefined,
        targetLangs: Array.isArray(body?.targetLangs) ? body.targetLangs : undefined,
        fps: typeof body?.fps === 'number' ? body.fps : undefined,
        data: body?.data,
        // Moving it to another project. The target is verified against the same
        // organisation inside the UPDATE — see lib/db/sequences.ts.
        projectId: typeof body?.projectId === 'string' ? body.projectId : undefined,
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

    if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })

    // Attach the upload this work came from, if the client named one. Two things
    // hang off the link: the sweeper stops treating a real recording as an
    // abandoned one, and the sequence is marked as already paid so translating
    // it does not charge for material the audio was charged for.
    const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : ''
    if (mediaId && sequence && (await attachMedia(ctx.orgId, mediaId, sequence.id))) {
      await markSequencePaid(ctx.orgId, sequence.id)
    }

    return NextResponse.json({ sequence })
  } catch (err) {
    if (err instanceof ConflictError) {
      // 409 rather than a silent overwrite. Two people editing the same
      // subtitles is ordinary in a production company, and whoever saves second
      // should be told rather than quietly winning.
      return NextResponse.json(
        { error: err.message, sequence: await getSequence(ctx.orgId, id) },
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

  const gone = await deleteSequence(ctx.orgId, (await params).id)
  if (!gone) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
