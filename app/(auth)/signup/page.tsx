'use client'

import Link from 'next/link'
import { useState } from 'react'

import { AuthCard, AuthForm, Field, FormError } from '@/components/auth/AuthCard'
import { signUp } from '@/lib/auth/client'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await signUp.email({ name, email, password })

    if (error) {
      setError(error.message ?? 'No se pudo crear la cuenta.')
      setLoading(false)
      return
    }

    // No redirect: the account exists but cannot sign in until the address is
    // confirmed, so sending them to the app would only bounce them back.
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthCard title="Revisa tu correo" subtitle="Ya casi está">
        <p>
          Hemos enviado un enlace de confirmación a <strong>{email}</strong>. Ábrelo para activar
          tu cuenta.
        </p>
        <p>Si no llega en unos minutos, mira en spam.</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Crear cuenta"
      subtitle="Empieza a subtitular"
      footer={<p>¿Ya tienes cuenta? <Link href="/login" className="link">Entrar</Link></p>}
    >
      <AuthForm onSubmit={handleSubmit}>
        <Field
          id="name"
          label="Nombre"
          type="text"
          autoComplete="name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
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
          hint="Mínimo 8 caracteres."
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        <FormError>{error}</FormError>

        <button type="submit" className="btn btn-primary btn-lg" aria-busy={loading || undefined}>
          Crear cuenta
        </button>
      </AuthForm>
    </AuthCard>
  )
}
