import Link from 'next/link'
import type { ReactNode } from 'react'

import { LEGAL_DOCS, publishedLegalSlugs } from '@/lib/legal'

import s from './marketing.module.css'

/**
 * The frame around every page a stranger can reach.
 *
 * The landing, the prices and the legal documents share the bar across the
 * top and the line of links at the bottom; drawn here so the three cannot
 * drift apart. A legal document is linked only once it is published — the
 * same test the route and the sitemap apply, asked in one place.
 */

/** The documents as a Spanish reader names them; the files keep their English titles. */
const LEGAL_LABEL: Record<keyof typeof LEGAL_DOCS, string> = {
  terms: 'Términos',
  privacy: 'Privacidad',
  dpa: 'Encargo de datos',
  subprocessors: 'Subencargados',
}

export default async function Shell({ children }: { children: ReactNode }) {
  const legal = await publishedLegalSlugs()

  return (
    <div className={s.page}>
      <header className={`topbar ${s.head}`}>
        <Link href="/" className="brand">captio</Link>
        <nav className={s.nav} aria-label="Principal">
          <Link href="/pricing" className="btn btn-quiet">Precios</Link>
          <Link href="/login" className="btn btn-quiet">Entrar</Link>
          <Link href="/signup" className="btn btn-primary">Empezar gratis</Link>
        </nav>
      </header>

      <main className={s.main}>{children}</main>

      <footer className={`${s.main} ${s.foot}`}>
        <span className="brand">captio</span>
        <nav className={s.footNav} aria-label="Pie">
          <Link href="/pricing">Precios</Link>
          <Link href="/login">Entrar</Link>
          {legal.map(slug => <Link key={slug} href={`/${slug}`}>{LEGAL_LABEL[slug]}</Link>)}
          <a href="mailto:hello@captio.studio">hello@captio.studio</a>
        </nav>
      </footer>
    </div>
  )
}
