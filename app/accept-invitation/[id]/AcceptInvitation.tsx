'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AuthCard, FormError, buttonStyle } from '@/components/auth/AuthCard'
import { organization } from '@/lib/auth/client'

export function AcceptInvitation({
  invitationId,
  organizationName,
  role,
}: {
  invitationId: string
  organizationName: string
  role: string
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const router = useRouter()

  async function accept() {
    setBusy('accept')
    setError('')

    const res = await organization.acceptInvitation({ invitationId })
    if (res.error) {
      setError(res.error.message ?? 'No se pudo aceptar la invitación.')
      setBusy(null)
      return
    }

    // Joining is not the same as switching: without this the session still has
    // no active organisation and the app would send them to onboarding, asking
    // them to create one they just joined.
    const orgId = res.data?.invitation?.organizationId
    if (orgId) await organization.setActive({ organizationId: orgId })

    router.push('/translate')
    router.refresh()
  }

  async function reject() {
    setBusy('reject')
    setError('')
    await organization.rejectInvitation({ invitationId })
    router.push('/')
  }

  return (
    <AuthCard title={`Únete a ${organizationName}`} subtitle="Tienes una invitación">
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)', marginBottom: 18 }}>
        Te han invitado a <strong style={{ color: 'var(--text)' }}>{organizationName}</strong> como{' '}
        <strong style={{ color: 'var(--text)' }}>{role}</strong>. Verás los proyectos de la
        organización y podrás trabajar en ellos.
      </p>

      <FormError>{error}</FormError>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <button onClick={accept} disabled={busy !== null} style={buttonStyle(busy === 'accept')}>
          {busy === 'accept' ? 'Entrando…' : 'Aceptar invitación'}
        </button>
        <button
          onClick={reject}
          disabled={busy !== null}
          style={{
            ...buttonStyle(busy === 'reject'),
            background: 'transparent',
            color: 'var(--text2)',
            border: '1px solid var(--border)',
          }}
        >
          Rechazar
        </button>
      </div>
    </AuthCard>
  )
}
