'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import {
  AuthCard,
  FormError,
  buttonStyle,
  inputStyle,
  labelStyle,
} from '@/components/auth/AuthCard'
import { signIn } from '@/lib/auth/client'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const params = useSearchParams()

  /**
   * Where to go after signing in.
   *
   * Only same-site paths are honoured. Taking the raw parameter would let a
   * crafted link send someone from our login straight to an attacker's page
   * with our brand still in their head — the classic open redirect.
   */
  const raw = params.get('next') ?? ''
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await signIn.email({ email, password })

    if (error) {
      // Better Auth reports an unverified account through this code; the generic
      // message would send people hunting for a typo in a correct password.
      setError(
        error.code === 'EMAIL_NOT_VERIFIED'
          ? 'Confirma tu correo antes de entrar. Revisa tu bandeja.'
          : (error.message ?? 'No se pudo iniciar sesión.'),
      )
      setLoading(false)
      return
    }

    // Where they end up is still the app layout's call: it sends anyone without
    // an organisation to onboarding regardless of this destination.
    router.push(next)
    router.refresh()
  }

  return (
    <AuthCard
      title="Iniciar sesión"
      subtitle="Entra en tu cuenta"
      footer={
        <>
          ¿No tienes cuenta?{' '}
          <Link href="/signup" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Crear una
          </Link>
          <div style={{ marginTop: 8 }}>
            <Link href="/forgot-password" style={{ color: 'var(--text3)', textDecoration: 'none' }}>
              ¿Has olvidado la contraseña?
            </Link>
          </div>
        </>
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
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="password" style={labelStyle}>
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
        </div>

        <FormError>{error}</FormError>

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </AuthCard>
  )
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering at build time.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
