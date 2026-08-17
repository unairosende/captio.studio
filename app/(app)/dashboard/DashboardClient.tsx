'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import TeamPanel from '@/components/team/TeamPanel'
import { signOut as endSession } from '@/lib/auth/client'
import type { MemberRow } from '@/lib/db/organizations'
import type { ProjectSummary } from '@/lib/db/projects'
import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'
import { LANG_CODES } from '@/lib/providers'
import { formatDuration, formatMonth, type MonthUsage } from '@/lib/usage'

interface Props {
  user: { id: string; email: string; role: string }
  organizationName: string
  projects: ProjectSummary[]
  members: MemberRow[]
  pendingInvitations: number
  entitlement: Entitlement
  subscription: {
    plan: string
    status: string
    seats: number
    currentPeriodEnd: string | null
  } | null
  /** Newest month first. Empty for an organisation that has run nothing. */
  usage: MonthUsage[]
}

/**
 * Elapsed time, said the way a person would say it.
 *
 * A column of `17/08/2026` tells you less at a glance than "2 hours ago", and it
 * sidesteps the trap absolute dates set for a component that renders twice: the
 * same instant formatted on a server running in UTC and again in the reader's
 * timezone is two different strings, which React reports as a hydration
 * mismatch. A difference between two clocks is the same everywhere.
 */
const RELATIVE = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

function ago(value: string | Date): string {
  const delta = new Date(value).getTime() - Date.now()
  if (Number.isNaN(delta)) return ''
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return RELATIVE.format(Math.round(delta / ms), unit)
  }
  return 'just now'
}

/** `Spanish` as `ES`, and anything unrecognised as itself. */
const short = (lang: string | null): string => (lang ? (LANG_CODES[lang] ?? lang) : '—')

/**
 * The first thing a customer sees after signing in.
 *
 * Three questions, in the order people ask them: what am I working on, who else
 * is here, and what have I used. The editor answers none of them — it is a room
 * with one document open in it — and every figure below was already in the
 * database waiting for a page to read it.
 */
export default function DashboardClient({
  user,
  organizationName,
  projects,
  members,
  pendingInvitations,
  entitlement,
  subscription,
  usage,
}: Props) {
  const router = useRouter()
  const [team, setTeam] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * This month by name, not by position.
   *
   * `usage[0]` is the most recent month with anything in it, which in the first
   * week of September is still August — and labelling that "this month" turns a
   * quiet start into a report that somebody has been busy.
   */
  const currentMonth = new Date().toISOString().slice(0, 7)
  const thisMonth = usage.find(m => m.month === currentMonth)

  const trial = entitlement.status === 'trial' ? entitlement.remaining : null

  async function remove(project: ProjectSummary) {
    if (!confirm(`Delete “${project.name}”? Its subtitles and comments go with it.`)) return

    setBusyId(project.id)
    setError(null)
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    setBusyId(null)

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? `Could not delete that project (HTTP ${res.status})`)
      return
    }
    // The list was drawn on the server, so the server has to draw it again.
    router.refresh()
  }

  async function signOut() {
    await endSession()
    router.push('/login')
    // Server components cache the session; without this the next render could
    // still be the signed-in one.
    router.refresh()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      {team && (
        <TeamPanel
          currentUserId={user.id}
          role={user.role}
          onClose={() => {
            setTeam(false)
            // Somebody may have been invited or removed while it was open, and
            // the counts on this page were rendered before that happened.
            router.refresh()
          }}
        />
      )}

      {/* Deliberately the editor's topbar, so the two read as one product. */}
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text2)' }}>{organizationName}</span>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', background: 'var(--accent-dim)', color: '#8ba8ff' }}>
          {entitlement.plan}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text3)' }}>{user.email}</span>
          <button className="btn btn-quiet" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '22px 16px 60px' }}>
        {/* A row that reflows on its own. Media queries would mean a stylesheet
            for a layout auto-fit already describes. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
          <div className="card">
            <div className="card-head">
              <span className="caps">{trial ? 'Free trial' : 'This month'}</span>
            </div>

            {trial ? (
              <>
                <Meter
                  label="Audio transcribed"
                  used={TRIAL.transcribeSeconds - trial.transcribeSeconds}
                  total={TRIAL.transcribeSeconds}
                  left={`${formatDuration(trial.transcribeSeconds)} left`}
                />
                <div style={{ height: 12 }} />
                <Meter
                  label="Subtitles translated"
                  used={TRIAL.translatedCues - trial.translatedCues}
                  total={TRIAL.translatedCues}
                  left={`${trial.translatedCues.toLocaleString('en-GB')} left`}
                />
                <a href="/pricing" style={{ display: 'inline-block', marginTop: 12, fontSize: 'var(--fs-sm)', color: 'var(--accent)', textDecoration: 'none' }}>
                  See plans →
                </a>
              </>
            ) : (
              <>
                <Figure value={formatDuration(thisMonth?.transcribeSeconds ?? 0)} label="audio transcribed" />
                <Figure
                  value={(thisMonth?.translatedCues ?? 0).toLocaleString('en-GB')}
                  label="subtitles translated"
                />
                <div className="muted" style={{ marginTop: 8 }}>
                  {(thisMonth?.calls ?? 0).toLocaleString('en-GB')} AI jobs run
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <span className="caps">Team</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {members.length} {members.length === 1 ? 'person' : 'people'}
              </span>
            </div>

            {/* The first few, not all of them. A card that grows with the
                organisation stops being a card — the panel is where the whole
                list lives, and it is one click away. */}
            {members.slice(0, 4).map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0' }}>
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name || m.email}
                  {m.user_id === user.id && <span className="muted"> · you</span>}
                </span>
                <span className="muted" style={{ marginLeft: 'auto', flexShrink: 0 }}>{m.role}</span>
              </div>
            ))}
            {members.length > 4 && (
              <div className="muted" style={{ paddingTop: 3 }}>and {members.length - 4} more</div>
            )}

            {pendingInvitations > 0 && (
              <div style={{ marginTop: 8, fontSize: 'var(--fs-sm)', color: 'var(--amber)' }}>
                {pendingInvitations} invitation{pendingInvitations === 1 ? '' : 's'} not yet accepted
              </div>
            )}

            <button className="btn" style={{ marginTop: 12 }} onClick={() => setTeam(true)}>
              {user.role === 'member' ? 'View team' : 'Manage team'}
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="caps">Plan</span>
            </div>

            <div style={{ fontSize: 18, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
              {subscription ? subscription.plan : 'Free trial'}
            </div>

            {subscription ? (
              <>
                <div className="muted" style={{ marginTop: 4 }}>
                  {members.length} of {subscription.seats} seat{subscription.seats === 1 ? '' : 's'} used
                </div>
                {subscription.currentPeriodEnd && (
                  <div className="muted">
                    {/* Formatted in UTC on purpose: the same instant rendered in
                        the server's timezone and again in the reader's is two
                        different strings, and React calls that a hydration
                        mismatch on a date nobody was reading that closely. */}
                    Renews{' '}
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </div>
                )}
                {subscription.status !== 'active' && (
                  <div className="err" style={{ marginTop: 6 }}>Status: {subscription.status}</div>
                )}
              </>
            ) : (
              <div className="muted" style={{ marginTop: 4 }}>
                No card on file, and nothing expiring — the trial is an amount
                rather than a fortnight.
              </div>
            )}

            <a href="/pricing" className="btn" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
              {subscription ? 'Change plan' : 'Subscribe'}
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '28px 0 12px' }}>
          <h1 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Projects</h1>
          <span className="muted">{projects.length}</span>
          <button
            className="btn btn-primary btn-lg"
            style={{ marginLeft: 'auto' }}
            onClick={() => router.push('/translate')}
          >
            New project
          </button>
        </div>

        {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}

        {projects.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '38px 16px' }}>
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text2)' }}>Nothing saved yet</div>
            <div className="muted" style={{ marginTop: 5 }}>
              Transcribe a file or import an SRT, then save it — it will be here
              for everybody in {organizationName}.
            </div>
            <button className="btn btn-primary btn-lg" style={{ marginTop: 14 }}
              onClick={() => router.push('/translate')}>
              Start a project
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 12 }}>
            {projects.map(p => (
              <div key={p.id} className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
                {/* A button rather than a clickable div: this is the way into the
                    project, and the way in should answer the keyboard. */}
                <button
                  onClick={() => router.push(`/translate?project=${p.id}`)}
                  style={{
                    flex: 1, textAlign: 'left', padding: '13px 15px 9px',
                    background: 'none', border: 'none', cursor: 'pointer', font: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  <div className="muted" style={{ fontFamily: 'var(--mono)', marginTop: 5 }}>
                    {p.cue_count.toLocaleString('en-GB')} cues · {short(p.source_lang)}
                    {p.target_langs.length > 0 && ` → ${p.target_langs.map(short).join(' ')}`}
                  </div>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 15px 11px' }}>
                  <span className="muted" suppressHydrationWarning>{ago(p.updated_at)}</span>
                  <button
                    className="btn btn-quiet btn-danger"
                    style={{ marginLeft: 'auto' }}
                    disabled={busyId === p.id}
                    onClick={() => void remove(p)}
                  >
                    {busyId === p.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Only once there is a past to look at: a table with one row in it is
            the card above, said twice. */}
        {usage.length > 1 && (
          <div className="card" style={{ marginTop: 28 }}>
            <div className="card-head">
              <span className="caps">Usage history</span>
            </div>
            {usage.map(m => (
              <div key={m.month} className="row" style={{ padding: '6px 0' }}>
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text2)', minWidth: 130 }}>
                  {formatMonth(m.month)}
                </span>
                <span className="muted" style={{ fontFamily: 'var(--mono)' }}>
                  {formatDuration(m.transcribeSeconds)} audio
                </span>
                <span className="muted" style={{ fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                  {m.translatedCues.toLocaleString('en-GB')} subtitles
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One trial allowance, spent and remaining. */
function Meter({
  label,
  used,
  total,
  left,
}: {
  label: string
  used: number
  total: number
  left: string
}) {
  const spent = Math.min(100, Math.round((used / total) * 100))
  // The same thresholds the editor's sidebar warns on, so the two can never
  // disagree about whether a trial is nearly gone.
  const state = spent >= 100 ? 'none' : spent >= 80 ? 'low' : ''

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span className="muted">{label}</span>
        <span className="muted" style={{ fontFamily: 'var(--mono)' }}>{left}</span>
      </div>
      <div className="meter">
        <div className={`meter-fill ${state}`} style={{ width: `${spent}%` }} />
      </div>
    </div>
  )
}

/** A number worth reading from across the desk, and what it counts. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 18, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</span>
      <span className="muted" style={{ marginLeft: 6 }}>{label}</span>
    </div>
  )
}
