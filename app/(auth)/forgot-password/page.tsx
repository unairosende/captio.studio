'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  AuthCard,
  FormError,
  buttonStyle,
  inputStyle,
  labelStyle,
} from '@/components/auth/AuthCard'
import { requestPasswordReset } from '@/lib/auth/client'
import { RESET_EXPIRY_HOURS } from '@/lib/auth/expiry'

/**
 * Asking for a way back in.
 *
 * `sendResetPassword` has been wired since organisations landed with nothing
 * able to reach it: a customer who forgot their password was locked out for
 * good — no self-service route, and no admin able to help either, because
 * passwords are hashed and nobody can look one up.
 *
 * The answer is the same whether or not the address belongs to an account. It
 * has to be: a page that says "no such account" is a page that tells anybody
 * which addresses on a list are registered here, and the staff addresses of a
 * production company are worth guessing at.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      await requestPasswordReset({
        email,
        // Where the emailed link lands. Better Auth appends the token to it.
        redirectTo: '/reset-password',
      })
      setSent(true)
    } catch {
      // Only a request that never arrived is reported. Anything the server
      // answered — including "no account like that" — gets the same reply
      // below, which is the entire point.
      setError('No se pudo contactar con el servidor. Inténtalo de nuevo.')
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthCard
        title="Revisa tu correo"
        subtitle="Recuperar la contraseña"
        footer={
          <Link href="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Volver a iniciar sesión
          </Link>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
          Si <strong style={{ color: 'var(--text)' }}>{email}</strong> tiene una cuenta, le hemos
          enviado un enlace para cambiar la contraseña. Caduca en{' '}
          {RESET_EXPIRY_HOURS === 1 ? 'una hora' : `${RESET_EXPIRY_HOURS} horas`}.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6, marginTop: 12 }}>
          ¿No llega? Mira en spam, y comprueba que la dirección esté bien escrita.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Recuperar la contraseña"
      subtitle="Te enviamos un enlace"
      footer={
        <Link href="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          Volver a iniciar sesión
        </Link>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="email" style={labelStyle}>
            Correo
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            style={inputStyle}
          />
        </div>

        <FormError>{error}</FormError>

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
    </AuthCard>
  )
}
