import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/site'

/**
 * What a crawler may read.
 *
 * The signed-in half of the product is disallowed because it is worthless in a
 * search result — but /reset-password and /accept-invitation are disallowed for
 * a different reason: both are reached with a single-use token in the query
 * string, and a crawler that follows one spends somebody's invitation for them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard',
        '/projects/',
        '/translate',
        '/onboarding',
        '/accept-invitation/',
        '/reset-password',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
