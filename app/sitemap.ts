import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/site'

/**
 * The two pages a stranger is meant to find.
 *
 * Everything else is either behind a session or carries a token in the query,
 * and neither belongs in a file whose whole purpose is to invite a crawler in.
 * The legal documents are drafts in docs/legal and are not served yet; they go
 * here on the day they are published, not before.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
  ]
}
