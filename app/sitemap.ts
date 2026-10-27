import type { MetadataRoute } from 'next'

import { publishedLegalSlugs } from '@/lib/legal'
import { SITE_URL } from '@/lib/site'

/**
 * The pages a stranger is meant to find.
 *
 * Everything else is either behind a session or carries a token in the query,
 * and neither belongs in a file whose whole purpose is to invite a crawler in.
 *
 * A legal document appears here only once it is published — the same test the
 * route itself applies, asked in one place so a draft cannot be advertised by a
 * sitemap that leads to a 404.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const legal = await publishedLegalSlugs()

  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    ...legal.map(slug => ({
      url: `${SITE_URL}/${slug}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ]
}
