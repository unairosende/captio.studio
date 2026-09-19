'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { AuthCard, AuthForm, Field, FormError } from '@/components/auth/AuthCard'
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
      // By code, not by message: Better Auth's messages are in English, and an
      // unverified account deserves its own answer — the generic one would send
      // people hunting for a typo in a correct password.
      setError(
        error.code === 'EMAIL_NOT_VERIFIED'
          ? 'Confirma tu correo antes de entrar. Revisa tu bandeja.'
          : error.code === 'INVALID_EMAIL_OR_PASSWORD'
            ? 'El correo o la contraseña no son correctos.'
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
          <p>¿No tienes cuenta? <Link href="/signup" className="link">Crear una</Link></p>
          <p><Link href="/forgot-password" className="link">¿Has olvidado la contraseña?</Link></p>
        </>
      }
    >
      <AuthForm onSubmit={handleSubmit}>
        <Field
          id="email"
          label="Correo"
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <Field
          id="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        <FormError>{error}</FormError>

        <button type="submit" className="btn btn-primary btn-lg" aria-busy={loading || undefined}>
          Entrar
        </button>
      </AuthForm>
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
