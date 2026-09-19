import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'

import './globals.css'
import './tokens.css'
import './ui.css'

/**
 * Fonts are fetched at build time and served from our own origin.
 *
 * Loading them from Google's CDN sends every visitor's IP address to Google
 * before anybody has consented to anything, which German courts have
 * repeatedly found unlawful. Self-hosting removes the transfer rather than
 * disclosing it, and costs one import.
 */
// Geist and Geist Mono, chosen on 2026-09-14 over a real cue row. tokens.css
// reads them as --sans and --mono.
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Captio — subtitulado en una sola ventana',
  description: 'Transcribir, traducir con glosario, revisar con el cliente y exportar subtítulos, en un solo sitio.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script below stamps data-theme on
    // <html> before React hydrates, so the server's HTML and the client's
    // attributes differ on purpose. Scoped to this one element.
    <html lang="es" className={`h-full ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="h-full">
        {/* The theme, before anything paints. A preference read after
            hydration would draw the page in one theme and flip it a moment
            later; read here, before React runs, it is right from the first
            frame. Absent means "follow the system", so nothing is stamped. */}
        <Script id="theme" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`}
        </Script>
        {children}
      </body>
    </html>
  )
}
