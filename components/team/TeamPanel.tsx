'use client'

import { useRouter } from 'next/navigation'
import { type InputHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from 'react'

import Dialog from '@/components/Dialog'
import { send } from '@/lib/api'
import { deleteUser, organization } from '@/lib/auth/client'
import { INVITATION_EXPIRY_DAYS } from '@/lib/auth/expiry'
import { ROLES, type Role, roleLabel } from '@/lib/roles'

import s from './team.module.css'

/**
 * Who is in the organisation, and what they may do.
 *
 * Sharing a project means sharing an organisation: every table carries an
 * `org_id`, so somebody who belongs here sees the work and somebody who does
 * not sees nothing. That is the whole access model, which is why this panel is
 * the only place it can be changed.
 *
 * The invitation machinery — the email, the accept page, the seven-day expiry —
 * has been in `lib/auth/server.ts` since organisations landed, with nothing able
 * to trigger it. This is the trigger.
 *
 * Everything here goes through Better Auth's own endpoints rather than routes of
 * ours: it owns these tables, and a second way to write them would be a second
 * set of rules to keep in step.
 */

const ROLE_HELP: Record<Role, string> = {
  member: 'Edita subtítulos y comenta',
  admin: 'Además invita a gente y lleva la facturación',
  owner: 'Lo mismo, y un administrador no puede quitarle',
}

/**
 * The refusals a person is likely to meet, in their language. Better Auth
 * answers in English; anything else falls through as it came, which beats a
 * translation that hides what actually happened.
 */
const REFUSAL: Record<string, string> = {
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'Esa persona ya está en la organización.',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: 'Esa persona ya tiene una invitación pendiente.',
  INVALID_PASSWORD: 'La contraseña no es correcta.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Tu cuenta no tiene contraseña porque entras con Google: deja el campo vacío.',
  SESSION_EXPIRED: 'Por seguridad, cierra sesión, vuelve a entrar y repítelo.',
  // Ours, from beforeDelete in lib/auth/server.ts.
  SOLE_OWNER: 'Eres el único propietario de una organización con más gente. Nombra otro propietario antes.',
}
const said = (err: { code?: string; message?: string }, fallback: string): string =>
  (err.code && REFUSAL[err.code]) || err.message || fallback

const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r)

interface Member {
  id: string
  role: string
  userId: string
  user: { name?: string | null; email: string }
}

interface Invitation {
  id: string
  email: string
  role?: string | null
  status: string
  expiresAt: string | Date
}

interface Props {
  /** So the panel never offers you the button that removes yourself. */
  currentUserId: string
  /** The caller's own role, read from the session on the server. */
  role: string
  /**
   * The organisation's name, which unlocks the danger zone.
   *
   * Only passed where deleting the account makes sense — the dashboard — and
   * left out in the editor, so the destructive control never sits under a track
   * somebody is mid-edit on. Its presence, plus an owner, is what draws the
   * section; the name is also what has to be typed back to confirm.
   */
  orgName?: string
  onClose: () => void
}

export default function TeamPanel({ currentUserId, role, orgName, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  /** Which invitation's link was last copied, so the button can say so. */
  const [copied, setCopied] = useState<string | null>(null)
  /** Shown when the clipboard is refused: the link itself, to copy by hand. */
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  const router = useRouter()

  const canManage = role === 'owner' || role === 'admin'
  /** Only an owner deletes the account, and only where the name was passed in. */
  const canDelete = role === 'owner' && !!orgName

  const refresh = useCallback(async () => {
    const [m, i] = await Promise.all([
      organization.listMembers(),
      // Pending invitations are the admins' business, and the endpoint agrees —
      // asking as a member comes back as an error rather than a list.
      canManage ? organization.listInvitations() : Promise.resolve({ data: null }),
    ])
    setMembers((m.data?.members ?? []) as unknown as Member[])
    setInvites(((i.data ?? []) as unknown as Invitation[]).filter(x => x.status === 'pending'))
  }, [canManage])

  // The panel is only mounted once somebody opens it, so mounting is the event
  // that should fetch. The rule cannot see that `refresh` awaits before it sets
  // anything — there is no synchronous render cascade here, only a request.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  async function invite() {
    const address = email.trim()
    if (!address || busy) return
    setBusy(true)
    setError(null)
    setSent(null)

    const res = await organization.inviteMember({ email: address, role: inviteRole })
    setBusy(false)
    setEmail('')

    // Refreshed either way. The invitation is written before the email is
    // attempted, so a failure here means the row exists and the message does
    // not — hiding the row would lose the one thing that can still be rescued.
    await refresh()

    if (res.error) {
      setError(said(res.error, 'No se pudo enviar la invitación'))
      return
    }
    // Deliberately not "sent". Whether the email left is decided in a background
    // task Better Auth does not report on, so a green "Invitation sent" here is
    // a claim this panel cannot make — and it was making it, over a message the
    // provider had already refused. What is true is that the invitation exists,
    // and that the link below works whether or not the email ever arrives.
    setSent(address)
  }

  /**
   * The link the email would have carried.
   *
   * Built here rather than fetched: it is the invitation id in a known path, and
   * the panel already has the id. Worth having whether or not the mail went out —
   * an admin who would rather send it over WhatsApp is not doing anything wrong.
   */
  const acceptUrl = (id: string) => `${window.location.origin}/accept-invitation/${id}`

  async function copyLink(inv: Invitation) {
    setError(null)
    setLinkToCopy(null)
    try {
      await navigator.clipboard.writeText(acceptUrl(inv.id))
      setCopied(inv.id)
    } catch {
      // The clipboard can be refused — a stricter browser, an insecure origin,
      // a click the browser did not consider a gesture. Showing the link is not
      // an error and is not styled as one: it is the same answer, delivered by
      // the one route left.
      setLinkToCopy(acceptUrl(inv.id))
    }
  }

  async function changeRole(m: Member, next: Role) {
    setError(null)
    const res = await organization.updateMemberRole({ memberId: m.id, role: next })
    if (res.error) {
      setError(said(res.error, 'No se pudo cambiar el rol'))
      return
    }
    await refresh()
  }

  async function remove(m: Member) {
    if (!confirm(`¿Quitar a ${m.user.email} de la organización?`)) return
    setError(null)
    const res = await organization.removeMember({ memberIdOrEmail: m.id })
    if (res.error) {
      setError(said(res.error, 'No se pudo quitar a esa persona'))
      return
    }
    await refresh()
  }

  async function cancel(inv: Invitation) {
    setError(null)
    // The green line names an invitation that is about to stop existing.
    setSent(null)
    const res = await organization.cancelInvitation({ invitationId: inv.id })
    if (res.error) {
      setError(said(res.error, 'No se pudo cancelar la invitación'))
      return
    }
    await refresh()
  }

  async function deleteOrg() {
    if (deleting || confirmText.trim() !== orgName) return
    setDeleting(true)
    setDeleteError(null)
    const res = await send('/api/organization', { confirm: confirmText.trim() }, 'DELETE')
    if (!res.ok) {
      setDeleting(false)
      setDeleteError(res.error)
      return
    }
    // Back to the dashboard, re-resolved on the server: the organisation this
    // session was working in is gone, so the (app) layout re-runs requireOrgContext
    // and sends them on — to another organisation if they belong to one, or to
    // onboarding (layout.tsx catches NoOrganizationError) if this was their last.
    router.push('/dashboard')
    router.refresh()
  }

  async function deleteAccount() {
    if (leaving) return
    setLeaving(true)
    setLeaveError(null)
    // No password means a Google account: Better Auth then wants a fresh session.
    const { error } = await deleteUser(password ? { password } : {})
    if (error) {
      setLeaving(false)
      setLeaveError(said(error, 'No se pudo borrar la cuenta'))
      return
    }
    // The session went with the account, so the refresh lands on the public page.
    router.push('/')
    router.refresh()
  }

  const expires = (at: string | Date) =>
    new Date(at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

  return (
    <Dialog label="Equipo" width="520px" height="72vh" onClose={onClose}>
        <div className="panel-head">
          <span className="panel-title">Equipo</span>
          <span className="muted">{members.length} {members.length === 1 ? 'persona' : 'personas'}</span>
          <button className="btn btn-quiet btn-icon panel-close" onClick={onClose} aria-label="Cerrar el equipo">×</button>
        </div>

        {canManage && (
          <div className={s.invite}>
            <div className={s.inviteRow}>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void invite() } }}
                type="email"
                placeholder="colega@productora.com"
                spellCheck={false}
                aria-label="Correo de la persona a invitar"
                className="field"
              />
              <div className="select-wrap">
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as Role)}
                  aria-label="Rol"
                  className="field"
                >
                  {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={() => void invite()} disabled={!email.trim()} aria-busy={busy || undefined}>
                Invitar
              </button>
            </div>
            <div className="field-msg">
              {ROLE_HELP[inviteRole]}. El enlace caduca en {INVITATION_EXPIRY_DAYS} días.
            </div>
            {sent && (
              <div className="ok">
                {sent} tiene su invitación. Si el correo no llega, copia el enlace de abajo.
              </div>
            )}
          </div>
        )}

        {error && <p className={`err ${s.line}`} role="alert">{error}</p>}

        {linkToCopy && (
          <div className={s.line}>
            <div className="muted">El navegador no ha dejado llegar al portapapeles. Copia esto:</div>
            <div className={s.url}>{linkToCopy}</div>
          </div>
        )}

        <div className={`panel-body ${s.body}`}>
          {members.map(m => (
            <div key={m.id} className="row">
              <div className={s.who}>
                <div className={s.name}>
                  {m.user.name || m.user.email}
                  {m.userId === currentUserId && <span className="muted"> · tú</span>}
                </div>
                <div className={s.email}>{m.user.email}</div>
              </div>

              {/* Nobody edits their own role or shows themselves the door. An
                  owner who demoted themselves by accident has no way back, and
                  the last one out would leave the organisation unadministrable. */}
              {canManage && m.userId !== currentUserId ? (
                <div className={s.tools}>
                  <div className="select-wrap">
                    <select
                      value={isRole(m.role) ? m.role : 'member'}
                      onChange={e => void changeRole(m, e.target.value as Role)}
                      aria-label={`Rol de ${m.user.email}`}
                      className="field"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-danger" onClick={() => void remove(m)} title="Quitar de la organización">
                    Quitar
                  </button>
                </div>
              ) : (
                <span className={s.role}>{roleLabel(m.role)}</span>
              )}
            </div>
          ))}

          {invites.length > 0 && (
            <>
              <span className={`caps ${s.pending}`}>Invitadas, sin aceptar</span>
              {invites.map(inv => (
                <div key={inv.id} className="row">
                  <span className={s.invEmail}>{inv.email}</span>
                  <span className={s.invRole}>{roleLabel(inv.role ?? 'member')}</span>
                  <span className={s.invWhen}>caduca el {expires(inv.expiresAt)}</span>
                  {/* Always offered, not only after a failure: the email is one
                      way to deliver a link, and not always the one that works. */}
                  <button className="btn" onClick={() => void copyLink(inv)} title="Copiar el enlace de la invitación">
                    {copied === inv.id ? 'Copiado' : 'Copiar enlace'}
                  </button>
                  <button className="btn" onClick={() => void cancel(inv)}>Cancelar</button>
                </div>
              ))}
            </>
          )}

          {!canManage && (
            <p className={`muted ${s.note}`}>Pide a un administrador que invite a alguien o cambie un rol.</p>
          )}

          {canDelete && (
            <DangerZone
              title="Zona de peligro"
              warning="Eliminar la organización borra sus proyectos, subtítulos, comentarios y archivos, y cancela la suscripción. No se puede deshacer."
              openLabel="Eliminar organización"
              prompt={<>Escribe <strong>{orgName}</strong> para confirmar. Esto es definitivo.</>}
              input={{
                value: confirmText,
                onChange: e => setConfirmText(e.target.value),
                'aria-label': 'Nombre de la organización para confirmar',
              }}
              ready={confirmText.trim() === orgName}
              busy={deleting}
              error={deleteError}
              onConfirm={() => void deleteOrg()}
              onReset={() => { setConfirmText(''); setDeleteError(null) }}
            />
          )}

          {orgName && (
            <DangerZone
              title="Tu cuenta"
              warning="Borrar tu cuenta borra tu nombre, tu correo y tu acceso. Las organizaciones donde estás solo se borran contigo, con todo lo que contienen y su suscripción; en las que compartes, el trabajo se queda y lo que escribiste pierde tu nombre. No se puede deshacer."
              openLabel="Borrar mi cuenta"
              prompt="Escribe tu contraseña para confirmar. Si entras con Google, déjala vacía."
              input={{
                type: 'password',
                value: password,
                onChange: e => setPassword(e.target.value),
                'aria-label': 'Tu contraseña',
                autoComplete: 'current-password',
              }}
              ready
              busy={leaving}
              error={leaveError}
              onConfirm={() => void deleteAccount()}
              onReset={() => { setPassword(''); setLeaveError(null) }}
            />
          )}
        </div>
    </Dialog>
  )
}

/**
 * A destructive action in two steps: a plain button, then something typed back
 * to prove it is meant — the organisation's name, or one's own password.
 */
function DangerZone({ title, warning, openLabel, prompt, input, ready, busy, error, onConfirm, onReset }: {
  title: string
  warning: string
  openLabel: string
  prompt: ReactNode
  input: InputHTMLAttributes<HTMLInputElement>
  ready: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={s.danger}>
      <span className="caps">{title}</span>
      {!open ? (
        <>
          <p className={s.dangerText}>{warning}</p>
          <button className="btn btn-danger" onClick={() => setOpen(true)}>
            {openLabel}
          </button>
        </>
      ) : (
        <>
          <p className={s.dangerText}>{prompt}</p>
          <div className={s.dangerConfirm}>
            <input
              autoComplete="off"
              {...input}
              onKeyDown={e => { if (e.key === 'Enter' && ready) { e.preventDefault(); onConfirm() } }}
              className="field"
              spellCheck={false}
            />
            <button className="btn btn-danger" onClick={onConfirm} disabled={!ready} aria-busy={busy || undefined}>
              Eliminar
            </button>
          </div>
          <button className="btn btn-quiet" onClick={() => { setOpen(false); onReset() }}>
            Cancelar
          </button>
        </>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  )
}
