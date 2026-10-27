'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { Actions, AuthCard } from '@/components/auth/AuthCard'

/**
 * What answers when a page throws while drawing.
 *
 * A boundary rather than a blank screen: the reader gets told what happened,
 * in Spanish, with the one thing they can do about it — try again — and the
 * way out if that does not help. Nothing saved is at stake here, and it says
 * so, because the first fear on seeing this is that the last hour is gone.
 *
 * The root layout stays up (fonts, theme), so the card looks like the rest of
 * the product rather than like a crash.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <AuthCard title="Algo ha fallado" subtitle="No es culpa tuya">
      <p>
        La pantalla no se ha podido dibujar. Lo que ya estaba guardado sigue guardado.
      </p>
      <p>
        Si vuelve a pasar, escríbenos a <a href="mailto:hello@captio.studio" className="link">hello@captio.studio</a> con
        lo que estabas haciendo{error.digest ? <> y este código: <code>{error.digest}</code></> : null}.
      </p>
      <Actions>
        <button className="btn btn-primary btn-lg" onClick={reset}>Volver a intentarlo</button>
        <Link href="/dashboard" className="btn btn-lg">Ir al panel</Link>
      </Actions>
    </AuthCard>
  )
}
