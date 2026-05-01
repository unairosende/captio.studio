import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Captio — Professional Subtitle Translation',
  description: 'AI-powered subtitle translation with quality checking, burn-in, and team collaboration.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  )
}
