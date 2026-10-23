import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, requireOrgContext } from '@/lib/auth/session'
import { isUuid } from '@/lib/db/client'
import { listRelatedTracks } from '@/lib/db/sequences'
import { correctedTranslations, readCues } from '@/lib/subtitles'

interface Params {
  params: Promise<{ id: string }>
}

/** Language names are a word or two; anything longer is not one of ours. */
const MAX_LANG = 64

/**
 * The lines this project and its client's other projects have already had
 * corrected into one language — so a translation can take them as they were
 * left rather than ask the model again and have them corrected twice.
 *
 * Only corrected lines: see `correctedTranslations`. Scoped by organisation
 * inside the query, so another organisation's project is simply empty.
 */
export async function GET(req: NextRequest, { params }: Params) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await params
  const lang = req.nextUrl.searchParams.get('lang') ?? ''
  if (!isUuid(id) || !lang || lang.length > MAX_LANG) {
    return NextResponse.json({ error: 'A project and a language are required' }, { status: 400 })
  }

  const tracks = (await listRelatedTracks(ctx.orgId, id)).map(t => {
    const { subtitles, translations } = readCues(t.data)
    return { subtitles, translation: translations[lang] }
  })

  return NextResponse.json({ memory: correctedTranslations(tracks) })
}
