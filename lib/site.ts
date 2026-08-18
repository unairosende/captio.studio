/**
 * Where this deployment lives, for the files that have to print absolute URLs.
 *
 * A sitemap with relative paths is not a sitemap, and a crawler given the wrong
 * host indexes the preview deployment instead of the product. The fallback is
 * the real domain rather than localhost for the same reason: if the variable is
 * missing in production, being wrong about the path is recoverable and being
 * wrong about the host is not.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://captio.studio').replace(/\/+$/, '')
