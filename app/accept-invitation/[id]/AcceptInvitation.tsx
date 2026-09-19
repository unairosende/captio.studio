'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Actions, AuthCard, FormError } from '@/components/auth/AuthCard'
import { organization } from '@/lib/auth/client'
import { roleLabel } from '@/lib/roles'

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
      <p>
        Te han invitado a <strong>{organizationName}</strong> como <strong>{roleLabel(role)}</strong>.
        Verás los proyectos de la organización y podrás trabajar en ellos.
      </p>

      <FormError>{error}</FormError>

      <Actions>
        <button className="btn btn-primary btn-lg" disabled={busy === 'reject'} aria-busy={busy === 'accept' || undefined} onClick={() => void accept()}>
          Aceptar invitación
        </button>
        <button className="btn btn-lg" disabled={busy === 'accept'} aria-busy={busy === 'reject' || undefined} onClick={() => void reject()}>
          Rechazar
        </button>
      </Actions>
    </AuthCard>
  )
}
