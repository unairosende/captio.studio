/**
 * Which product this deployment is.
 *
 * The same code runs as the product that is sold and as private copies under
 * another name, each its own Vercel project with its own environment. Public
 * variables because client components draw the wordmark; they are read at
 * build time, so changing one means redeploying.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Captio',
  contact: process.env.NEXT_PUBLIC_BRAND_CONTACT || 'hello@captio.studio',
} as const
