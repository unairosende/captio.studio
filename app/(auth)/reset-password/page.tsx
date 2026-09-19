'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { AuthCard, AuthForm, Field, FormError } from '@/components/auth/AuthCard'
import { resetPassword } from '@/lib/auth/client'

/** Better Auth's own floor, stated here so the form can refuse before the round trip. */
const MIN_LENGTH = 8

function ResetPasswordForm() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // Checked here as well as by the browser: a mismatch caught after the token
    // is spent means asking for another email to fix a typo.
    if (password !== confirm) {
      setError('Las dos contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error } = await resetPassword({ newPassword: password, token })

    if (error) {
      // A token is single-use and short-lived, so this is usually one of those
      // two — worth saying, because the way out is a new email, not retrying.
      setError(error.message ?? 'El enlace ya se ha usado o ha caducado. Pide otro.')
      setLoading(false)
      return
    }

    // To the login rather than straight in: they have just proved they hold the
    // inbox, not that they can remember the password they have chosen.
    router.push('/login')
    router.refresh()
  }

  /**
   * No token, no form.
   *
   * Somebody who reaches this page by hand, or through a mail client that ate
   * the query string, would otherwise type a password twice and be told at the
   * end that it failed. Cheaper to say so before they start.
   */
  if (!token) {
    return (
      <AuthCard
        title="Enlace no válido"
        subtitle="Cambiar la contraseña"
        footer={<p><Link href="/forgot-password" className="link">Pedir uno nuevo</Link></p>}
      >
        <p>Este enlace está incompleto o ha caducado. Pide otro y úsalo cuanto antes.</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Elige una contraseña nueva"
      subtitle="Cambiar la contraseña"
      footer={<p><Link href="/login" className="link">Volver a iniciar sesión</Link></p>}
    >
      <AuthForm onSubmit={handleSubmit}>
        <Field
          id="password"
          label="Contraseña nueva"
          hint={`Mínimo ${MIN_LENGTH} caracteres.`}
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoFocus
        />
        <Field
          id="confirm"
          label="Repítela"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
        />

        <FormError>{error}</FormError>

        <button type="submit" className="btn btn-primary btn-lg" aria-busy={loading || undefined}>
          Guardar contraseña
        </button>
      </AuthForm>
    </AuthCard>
  )
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering at build time — same as the login page next door.
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
