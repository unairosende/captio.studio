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
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)' }}>
          Hemos enviado un enlace de confirmación a{' '}
          <strong style={{ color: 'var(--text)' }}>{email}</strong>. Ábrelo para activar tu cuenta.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text3)', marginTop: 14 }}>
          Si no llega en unos minutos, mira en spam.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Crear cuenta"
      subtitle="Empieza a subtitular"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="name" style={labelStyle}>
            Nombre
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
            Mínimo 8 caracteres.
          </div>
        </div>

        <FormError>{error}</FormError>

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
    </AuthCard>
  )
}
