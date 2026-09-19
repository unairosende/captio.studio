import type { Metadata } from 'next'
import Link from 'next/link'

import { AuthCard } from '@/components/auth/AuthCard'

export const metadata: Metadata = { title: 'No existe · Captio' }

/**
 * What answers when a page does not exist.
 *
 * A project of another organisation, a sequence that was deleted, a link with
 * a typo in it: all three end here, and all three say the same thing — the
 * difference would confirm that an id somebody guessed at was once real.
 * Without this file the answer was the framework's own page, in English and
 * in nobody's typeface.
 */
export default function NotFound() {
  return (
    <AuthCard
      title="Esta página no existe"
      subtitle="Nada por aquí"
      footer={<p><Link href="/" className="link">Ir al inicio</Link></p>}
    >
      <p>
        La dirección está mal escrita, o lo que había aquí se ha borrado o pertenece a otra
        organización.
      </p>
    </AuthCard>
  )
}
