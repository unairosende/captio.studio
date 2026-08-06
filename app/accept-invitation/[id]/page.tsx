import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthCard } from '@/components/auth/AuthCard'
import { auth } from '@/lib/auth/server'

import { AcceptInvitation } from './AcceptInvitation'

/**
 * Where the invitation email lands.
 *
 * Outside the (app) group on purpose: the person following this link has no
 * organisation yet, and that layout would redirect them to onboarding — telling
 * someone to create a productora when they were invited to join one.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const h = await headers()

  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) redirect(`/login?next=/accept-invitation/${id}`)

  // Better Auth refuses an invitation addressed to a different account, so a
  // forwarded link cannot be used by whoever happens to receive it.
  const invitation = await auth.api.getInvitation({ query: { id }, headers: h }).catch(() => null)

  if (!invitation) {
    return (
      <AuthCard title="Invitación no válida" subtitle="No pudimos abrirla">
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text2)' }}>
          Esta invitación ha caducado, ya se usó, o va dirigida a otra dirección de correo. Pide a
          la organización que te envíe una nueva.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text3)', marginTop: 14 }}>
          Has entrado como {session.user.email}.
        </p>
      </AuthCard>
    )
  }

  return (
    <AcceptInvitation
      invitationId={id}
      organizationName={invitation.organizationName}
      role={invitation.role}
    />
  )
}
