import Link from 'next/link'
import { notFound } from 'next/navigation'

import { readLegalDocument, type LegalSlug } from '@/lib/legal'

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
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      <nav style={{ padding: '16px 32px', borderBottom: '1px solid var(--border)', background: 'var(--bg1)' }}>
        <Link href="/" style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em', textDecoration: 'none' }}>
          Captio
        </Link>
      </nav>

      <article className="legal">
        {!doc.published && (
          <p className="err" style={{ fontSize: 'var(--fs-base)', border: '1px solid var(--red)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
            Draft — visible in development only. It starts being served the day
            docs/legal/{doc.slug}.md carries <code>Status: published</code> on a
            line of its own, with no <code>[PLACEHOLDER]</code> left in it.
          </p>
        )}
        <div dangerouslySetInnerHTML={{ __html: doc.html }} />
      </article>
    </div>
  )
}
