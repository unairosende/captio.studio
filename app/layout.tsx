import type { Metadata } from 'next'
import { Geist, Geist_Mono, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'

import './globals.css'
import './tokens.css'

/**
 * Fonts are fetched at build time and served from our own origin.
 *
 * Loading them from Google's CDN sends every visitor's IP address to Google
 * before anybody has consented to anything, which German courts have
 * repeatedly found unlawful. Self-hosting removes the transfer rather than
 * disclosing it, and costs one import.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

/**
 * The redesign's faces, chosen on 2026-09-14 over a real cue row. They ride
 * alongside the two above while screens migrate to the `.v2` tokens; when the
 * last screen has moved, Plex and JetBrains go and these take their names.
 */
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Captio — Professional Subtitle Translation',
  description: 'AI-powered subtitle translation with quality checking, glossaries, and team review.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${sans.variable} ${mono.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  )
}
