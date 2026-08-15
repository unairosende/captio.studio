'use client'

import { type CSSProperties, useCallback, useEffect, useState } from 'react'

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

  return (
    <div
      className="overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Team"
    >
      <div className="panel" style={{ '--panel-w': '480px', '--panel-h': '70vh' } as CSSProperties}>
        <div className="panel-head">
          <span className="panel-title">Team</span>
          <span className="muted">
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
          <button className="panel-close" onClick={onClose} aria-label="Close team">×</button>
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
                className="field"
                style={{ flex: 1 }}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as Role)}
                aria-label="Role"
                className="field"
                style={{ cursor: 'pointer' }}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn btn-primary btn-lg" onClick={() => void invite()}
                disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Invite'}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 5 }}>
              {ROLE_HELP[inviteRole]}. The link expires in seven days.
            </div>
            {sent && <div className="ok" style={{ marginTop: 5 }}>Invitation sent to {sent}.</div>}
          </div>
        )}

        {error && <div className="err" style={{ padding: '8px 13px 0' }}>{error}</div>}

        <div className="panel-body" style={{ padding: '6px 13px 12px' }}>
          {members.map(m => (
            <div key={m.id} className="row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
                  {m.user.name || m.user.email}
                  {m.userId === currentUserId && (
                    <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}> · you</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>
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
                    className="field"
                    style={{ fontSize: 'var(--fs-sm)', padding: '3px 6px', cursor: 'pointer' }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button className="btn btn-danger" onClick={() => void remove(m)}
                    title="Remove from the organisation">
                    Remove
                  </button>
                </div>
              ) : (
                <span className="muted" style={{ marginLeft: 'auto' }}>{m.role}</span>
              )}
            </div>
          ))}

          {invites.length > 0 && (
            <>
              <div className="caps" style={{ margin: '12px 0 4px' }}>
                Invited, not yet accepted
              </div>
              {invites.map(inv => (
                <div key={inv.id} className="row" style={{ padding: '6px 0' }}>
                  <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text2)', wordBreak: 'break-all' }}>
                    {inv.email}
                  </div>
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                    {inv.role ?? 'member'}
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)', marginLeft: 'auto' }}>
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <button className="btn" onClick={() => void cancel(inv)}>Cancel</button>
                </div>
              ))}
            </>
          )}

          {!canManage && (
            <div className="muted" style={{ marginTop: 10 }}>
              Ask an admin to invite somebody or change a role.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
