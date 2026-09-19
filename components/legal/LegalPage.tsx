import { notFound } from 'next/navigation'

import Shell from '@/components/marketing/Shell'
import { readLegalDocument, type LegalSlug } from '@/lib/legal'

import s from './legal.module.css'

/**
 * One legal document, rendered from its markdown in docs/legal.
 *
 * The markdown is the source, not a copy of it. Two versions of a privacy
 * policy is one version too many: whichever is wrong is the one somebody reads.
 *
 * A draft is visible in development and does not exist in production. The route
 * can therefore be built, linked and reviewed now, and starts answering the day
 * the placeholders come out — with no code change, which is the point.
 */
export default async function LegalPage({ slug }: { slug: LegalSlug }) {
  const doc = await readLegalDocument(slug)
  if (!doc.published && process.env.NODE_ENV === 'production') notFound()

  return (
    <Shell>
      <article className={s.article}>
        {!doc.published && (
          <p className={s.draft} role="note">
            Borrador, visible solo en desarrollo. Empieza a servirse el día que
            docs/legal/{doc.slug}.md lleve <code>Status: published</code> en una línea propia, sin
            ningún <code>[PLACEHOLDER]</code> dentro.
          </p>
        )}
        <div dangerouslySetInnerHTML={{ __html: doc.html }} />
      </article>
    </Shell>
  )
}
