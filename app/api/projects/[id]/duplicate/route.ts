import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { isUuid } from '@/lib/db/client'
import { playableMediaInProject } from '@/lib/db/media'
import { duplicateProject, getProject } from '@/lib/db/projects'
import { StorageNotConfiguredError, copyObject, deleteObject, newStorageKey } from '@/lib/storage/r2'

import { MAX_NAME } from '../../route'

interface Params {
  params: Promise<{ id: string }>
}

/** Copying a master inside the bucket is quick, but a project can hold a season of them. */
export const maxDuration = 300

/**
 * A copy of the project, to start the next job from — see duplicateProject in
 * lib/db/projects.ts for what comes across and what stays behind.
 *
 * Named after the original unless the request says otherwise, so the copy
 * sits beside it in the list and nobody mistakes which is which.
 *
 * The pictures are copied in the bucket first and the rows written after, so
 * a copy that failed leaves no row pointing at nothing. Rows that then fail
 * to write leave objects nothing points at, which are deleted on the way out.
 */
export async function POST(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const source = isUuid(id) ? await getProject(ctx.orgId, id) : null
  if (!source) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const asked = typeof body?.name === 'string' ? body.name.trim() : ''
  const name = (asked || `${source.name} (copia)`).slice(0, MAX_NAME)

  const copies: { id: string; storageKey: string }[] = []
  const discard = () => Promise.all(copies.map(c => deleteObject(c.storageKey)))
  // Settled, not raced: every copy has finished, or failed, before anything
  // is discarded — otherwise one still in flight lands after the clean-up.
  const settled = await Promise.allSettled(
    (await playableMediaInProject(ctx.orgId, id)).map(async m => {
      const storageKey = newStorageKey(ctx.orgId, m.filename ?? m.storage_key)
      if (!(await copyObject(m.storage_key, storageKey))) throw new Error(`Could not copy ${m.filename ?? 'a file'}`)
      copies.push({ id: m.id, storageKey })
    }),
  )
  const failed = settled.find(r => r.status === 'rejected')
  if (failed) {
    await discard()
    const err: unknown = failed.reason
    if (err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not copy the media' }, { status: 502 })
  }

  let project
  try {
    project = await duplicateProject(ctx.orgId, id, name, ctx.userId, copies)
  } catch (err) {
    await discard()
    throw err
  }
  if (!project) {
    await discard()
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json({ project }, { status: 201 })
}
