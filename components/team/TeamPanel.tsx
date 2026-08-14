'use client'

import { useCallback, useEffect, useState } from 'react'

import { organization } from '@/lib/auth/client'

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

const ROLES = ['member', 'admin', 'owner'] as const
type Role = typeof ROLES[number]

const ROLE_HELP: Record<Role, string> = {
  member: 'Edits subtitles and comments',
  admin: 'Also invites people and handles billing',
  owner: 'The same, and cannot be removed by an admin',
}

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
  onClose: () => void
}

export default function TeamPanel({ currentUserId, role, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const canManage = role === 'owner' || role === 'admin'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function invite() {
    const address = email.trim()
    if (!address || busy) return
    setBusy(true)
    setError(null)
    setSent(null)

    const res = await organization.inviteMember({ email: address, role: inviteRole })
    setBusy(false)

    if (res.error) {
      setError(res.error.message ?? 'Could not send that invitation')
      return
    }
    setEmail('')
    // Said out loud, because the invitation lands in somebody else's inbox: on
    // its own, a new row in the list below is a weak thing to call confirmation.
    setSent(address)
    await refresh()
  }

  async function changeRole(m: Member, next: Role) {
    setError(null)
    const res = await organization.updateMemberRole({ memberId: m.id, role: next })
    if (res.error) {
      setError(res.error.message ?? 'Could not change that role')
      return
    }
    await refresh()
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.user.email} from the organisation?`)) return
    setError(null)
    const res = await organization.removeMember({ memberIdOrEmail: m.id })
    if (res.error) {
      setError(res.error.message ?? 'Could not remove them')
      return
    }
    await refresh()
  }

  async function cancel(inv: Invitation) {
    setError(null)
    const res = await organization.cancelInvitation({ invitationId: inv.id })
    if (res.error) {
      setError(res.error.message ?? 'Could not cancel that invitation')
      return
    }
    await refresh()
  }

  const btn = {
    padding: '3px 8px', borderRadius: 4, fontSize: 11, lineHeight: 1.5, cursor: 'pointer',
    border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text3)',
  } as const

  const field = {
    padding: '5px 8px', borderRadius: 5, fontSize: 12,
    border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
  } as const

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh',
        background: 'rgba(0,0,0,.5)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Team"
    >
      <div style={{
        width: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--bg1)',
        boxShadow: '0 18px 50px rgba(0,0,0,.45)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Team</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
          <button onClick={onClose} aria-label="Close team"
            style={{ ...btn, marginLeft: 'auto', border: 'none', background: 'none', fontSize: 15 }}>
            ×
          </button>
        </div>

        {canManage && (
          <div style={{ padding: '10px 13px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void invite() } }}
                type="email"
                placeholder="colleague@example.com"
                spellCheck={false}
                aria-label="Email to invite"
                style={{ ...field, flex: 1 }}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as Role)}
                aria-label="Role"
                style={{ ...field, cursor: 'pointer' }}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => void invite()} disabled={busy || !email.trim()}
                style={{ ...btn, padding: '5px 11px', color: 'var(--text)', borderColor: 'var(--accent)' }}>
                {busy ? 'Sending…' : 'Invite'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5 }}>
              {ROLE_HELP[inviteRole]}. The link expires in seven days.
            </div>
            {sent && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 5 }}>
                Invitation sent to {sent}.
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ padding: '8px 13px 0', fontSize: 11, color: 'var(--red)' }}>{error}</div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 13px 12px' }}>
          {members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>
                  {m.user.name || m.user.email}
                  {m.userId === currentUserId && (
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}> · you</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', wordBreak: 'break-all' }}>
                  {m.user.email}
                </div>
              </div>

              {/* Nobody edits their own role or shows themselves the door. An
                  owner who demoted themselves by accident has no way back, and
                  the last one out would leave the organisation unadministrable. */}
              {canManage && m.userId !== currentUserId ? (
                <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
                  <select
                    value={(ROLES as readonly string[]).includes(m.role) ? m.role : 'member'}
                    onChange={e => void changeRole(m, e.target.value as Role)}
                    aria-label={`Role for ${m.user.email}`}
                    style={{ ...field, fontSize: 11, padding: '3px 6px', cursor: 'pointer' }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => void remove(m)} style={{ ...btn, color: 'var(--red)' }}
                    title="Remove from the organisation">
                    Remove
                  </button>
                </div>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
                  {m.role}
                </span>
              )}
            </div>
          ))}

          {invites.length > 0 && (
            <>
              <div style={{
                fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase',
                color: 'var(--text3)', margin: '12px 0 4px',
              }}>
                Invited, not yet accepted
              </div>
              {invites.map(inv => (
                <div key={inv.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text2)', wordBreak: 'break-all' }}>
                    {inv.email}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{inv.role ?? 'member'}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <button onClick={() => void cancel(inv)} style={btn}>Cancel</button>
                </div>
              ))}
            </>
          )}

          {!canManage && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
              Ask an admin to invite somebody or change a role.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
