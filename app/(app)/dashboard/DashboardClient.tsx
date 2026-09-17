'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import TeamPanel from '@/components/team/TeamPanel'
import { ago } from '@/lib/ago'
import { signOut as endSession } from '@/lib/auth/client'
import type { MemberRow } from '@/lib/db/organizations'
import type { ProjectSummary } from '@/lib/db/projects'
import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'
import { LANG_CODES } from '@/lib/providers'
import { formatDuration, formatMonth, type MonthUsage } from '@/lib/usage'

import s from './dashboard.module.css'

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

/** `Spanish` as `ES`, and anything unrecognised as itself. */
const short = (lang: string | null): string => (lang ? (LANG_CODES[lang] ?? lang) : '—')

/** The role as the reader says it. The database keeps the English key. */
const ROLE: Record<string, string> = { owner: 'propietario', admin: 'administrador', member: 'miembro' }
const roleLabel = (role: string): string => ROLE[role] ?? role

/**
 * The first thing a customer sees after signing in.
 *
 * Three questions, in the order people ask them: what am I working on, who
 * else is here, and what have I used. The editor answers none of them, and
 * every figure below was already in the database waiting for a page to read
 * it.
 *
 * Read, not operated: direction B's own rule for a surface like this one.
 * Bigger type, more room between things, and the accent allowed back in —
 * inside the editor it cedes to the quality checks, but there is nothing
 * here for it to collide with.
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
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  /**
   * The name being typed for a new project, and whether the field is showing.
   *
   * An inline field rather than `prompt()`. The browser dialog is not something
   * to rely on: it is blocked outright in a sandboxed frame, browsers disable it
   * after a page uses it a few times, and when it is refused the call throws —
   * which is how this button came to do nothing at all, silently, while looking
   * perfectly fine.
   */
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')

  /**
   * This month by name, not by position.
   *
   * `usage[0]` is the most recent month with anything in it, which in the first
   * week of September is still August — and labelling that "este mes" turns a
   * quiet start into a report that somebody has been busy.
   */
  const currentMonth = new Date().toISOString().slice(0, 7)
  const thisMonth = usage.find(m => m.month === currentMonth)

  const trial = entitlement.status === 'trial' ? entitlement.remaining : null

  async function create() {
    const name = newName.trim()
    if (!name) return

    setCreating(true)
    setError(null)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const json = await res.json().catch(() => ({}))
    setCreating(false)

    if (!res.ok) {
      setError(json.error ?? `No se pudo crear el proyecto (HTTP ${res.status})`)
      return
    }
    setNaming(false)
    setNewName('')
    // Straight into it: nobody creates a project in order to look at it empty.
    router.push(`/projects/${json.project.id}`)
  }

  /**
   * Hand over to Stripe's portal rather than answering the question here.
   *
   * The link is single-use and short-lived, which is why it is fetched on the
   * click instead of rendered into the page.
   */
  async function manageBilling() {
    setPortalBusy(true)
    setPortalError(null)

    const res = await fetch('/api/portal', { method: 'POST' })
    const json = await res.json().catch(() => ({}))

    if (res.ok && json.url) {
      // Left busy on purpose: the navigation is already happening, and a button
      // that re-enables first invites a second portal session nobody asked for.
      window.location.href = json.url
      return
    }

    setPortalBusy(false)
    setPortalError(json.error ?? `No se pudo abrir el portal de facturación (HTTP ${res.status})`)
  }

  /** The field, wherever it is shown — under the heading, or in the empty state. */
  const nameField = (
    <div className={`card ${s.namingCard}`}>
      <input
        className={`field ${s.namingField}`}
        autoFocus
        value={newName}
        placeholder="La película, la serie, la campaña…"
        aria-label="Nombre del proyecto nuevo"
        onChange={e => setNewName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void create() }
          if (e.key === 'Escape') { setNaming(false); setNewName('') }
        }}
      />
      <button className="btn btn-primary btn-lg" disabled={creating || !newName.trim()}
        onClick={() => void create()}>
        {creating ? 'Creando…' : 'Crear'}
      </button>
      <button className="btn btn-quiet" onClick={() => { setNaming(false); setNewName('') }}>
        Cancelar
      </button>
    </div>
  )

  async function remove(project: ProjectSummary) {
    // The count, not "are you sure?" — which is a question nobody has the
    // information to answer. Everything inside goes: sequences, their comments
    // and their history.
    const inside =
      project.sequence_count === 0
        ? 'No tiene nada dentro.'
        : `Sus ${project.sequence_count} secuencia${project.sequence_count === 1 ? '' : 's'} se van con él, y sus comentarios.`
    if (!confirm(`¿Eliminar «${project.name}»? ${inside}`)) return

    setBusyId(project.id)
    setError(null)
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    setBusyId(null)

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? `No se pudo eliminar el proyecto (HTTP ${res.status})`)
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
    <div className={`v2 ${s.page}`}>
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

      <header className={`topbar ${s.head}`}>
        <Link href="/dashboard" className="brand">captio</Link>
        <span className={s.org}>{organizationName}</span>
        <span className={s.plan}>{entitlement.plan}</span>
        <div className={s.headEnd}>
          <span className={s.email}>{user.email}</span>
          <button className="btn btn-quiet" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </header>

      <main className={s.main}>
        <div className={s.grid3}>
          <div className="card">
            <div className="card-head">
              <span className="caps">{trial ? 'Prueba gratuita' : 'Este mes'}</span>
            </div>

            {trial ? (
              <>
                {/* One meter, because there is one pool now. Two bars for two
                    limits was how a customer discovered, mid-job, that the one
                    they were not watching had run out. */}
                <div className={s.meterRow}>
                  <span className="muted">Material procesado</span>
                  <span className="muted" style={{ fontFamily: 'var(--mono)' }}>
                    quedan {formatDuration(trial.mediaSeconds)}
                  </span>
                </div>
                <Meter used={TRIAL.mediaMinutes * 60 - trial.mediaSeconds} total={TRIAL.mediaMinutes * 60} />
                <a href="/pricing" className="link" style={{ display: 'inline-block', marginTop: 12 }}>
                  Ver planes →
                </a>
              </>
            ) : (
              <>
                {/* The plan's ceiling, now that there is one to draw. This card
                    used to show plain figures because nothing enforced the
                    monthly allowance; lib/entitlement.ts does, so a subscriber
                    gets the same warning here as in the editor's pipeline
                    rather than meeting the wall on a deadline.

                    Still absent for a plan this build cannot price — that case
                    is deliberately left uncapped, and a meter would draw a
                    ceiling nobody is enforcing. */}
                {entitlement.status === 'subscribed' && entitlement.monthly ? (
                  <>
                    {/* Minutes of material, which is what the plans are sold
                        in and what monthlyFrom() counts — not subtitles. This
                        read "Subtítulos traducidos" over a Studio ceiling of
                        3 000, which is fifty hours of footage and not three
                        thousand lines; the customer had no way to tell which. */}
                    <div className={s.meterRow}>
                      <span className="muted">Material procesado</span>
                      <span className="muted" style={{ fontFamily: 'var(--mono)' }}>
                        quedan {formatDuration(entitlement.monthly.remaining * 60)}
                      </span>
                    </div>
                    <Meter used={entitlement.monthly.used} total={entitlement.monthly.limit} />
                  </>
                ) : (
                  <div className={s.figureRow}>
                    <span className={s.figure}>{(thisMonth?.translatedCues ?? 0).toLocaleString('es-ES')}</span>
                    <span className={s.figureLabel}>subtítulos traducidos</span>
                  </div>
                )}

                {/* Audio is not capped: the plans are sold in subtitles and
                    promise nothing about hours, so this is a figure and not a
                    meter. */}
                <div className={s.figureRow}>
                  <span className={s.figure}>{formatDuration(thisMonth?.transcribeSeconds ?? 0)}</span>
                  <span className={s.figureLabel}>audio transcrito</span>
                </div>

                <div className={`muted ${s.calls}`}>
                  {(thisMonth?.calls ?? 0).toLocaleString('es-ES')} tareas de IA ejecutadas
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <span className="caps">Equipo</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {members.length} {members.length === 1 ? 'persona' : 'personas'}
              </span>
            </div>

            {/* The first few, not all of them. A card that grows with the
                organisation stops being a card — the panel is where the whole
                list lives, and it is one click away. */}
            {members.slice(0, 4).map(m => (
              <div key={m.id} className={s.memberRow}>
                <span className={s.memberName}>
                  {m.name || m.email}
                  {m.user_id === user.id && <span className="muted"> · tú</span>}
                </span>
                <span className={`muted ${s.memberRole}`}>{roleLabel(m.role)}</span>
              </div>
            ))}
            {members.length > 4 && (
              <div className={`muted ${s.moreMembers}`}>y {members.length - 4} más</div>
            )}

            {pendingInvitations > 0 && (
              <div className={s.pending}>
                {pendingInvitations} invitación{pendingInvitations === 1 ? '' : 'es'} sin aceptar
              </div>
            )}

            <button className={`btn ${s.action}`} onClick={() => setTeam(true)}>
              {user.role === 'member' ? 'Ver equipo' : 'Gestionar equipo'}
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="caps">Plan</span>
            </div>

            <div className={s.planName}>
              {subscription ? subscription.plan : 'Prueba gratuita'}
            </div>

            {subscription ? (
              <>
                <div className={`muted ${s.planLine}`}>
                  {members.length} de {subscription.seats} plaza{subscription.seats === 1 ? '' : 's'} usadas
                </div>
                {subscription.currentPeriodEnd && (
                  <div className={`muted ${s.planLine}`}>
                    {/* Formatted in UTC on purpose: the same instant rendered in
                        the server's timezone and again in the reader's is two
                        different strings, and React calls that a hydration
                        mismatch on a date nobody was reading that closely. */}
                    Renueva el{' '}
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString('es-ES', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </div>
                )}
                {subscription.status !== 'active' && (
                  <div className={`err ${s.status}`}>Estado: {subscription.status}</div>
                )}
              </>
            ) : (
              <div className={`muted ${s.planLine}`}>
                Sin tarjeta registrada, y nada caduca — la prueba es una
                cantidad, no una quincena.
              </div>
            )}

            {subscription && user.role !== 'member' ? (
              <>
                <button className={`btn ${s.action}`} disabled={portalBusy} onClick={() => void manageBilling()}>
                  {portalBusy ? 'Abriendo…' : 'Gestionar facturación'}
                </button>
                {portalError && <div className={`err ${s.actionErr}`}>{portalError}</div>}
              </>
            ) : !subscription ? (
              <a href="/pricing" className={`btn ${s.action}`} style={{ display: 'inline-block' }}>
                Suscribirse
              </a>
            ) : null}
          </div>
        </div>

        <div className={s.projectsHead}>
          <h2>Proyectos</h2>
          <span className="muted">{projects.length}</span>
          <div className={s.spacer} />
          <button className="btn btn-primary btn-lg" disabled={naming} onClick={() => setNaming(true)}>
            Nuevo proyecto
          </button>
        </div>

        {error && <div className={`err ${s.actionErr}`}>{error}</div>}

        {naming && nameField}

        {projects.length === 0 ? (
          <div className="empty">
            <span className="empty-title">Ningún proyecto todavía</span>
            <p>
              Un proyecto es un encargo — una película, un episodio, una
              campaña — y agrupa las secuencias en las que se divide, junto
              con la terminología que todas comparten. Todo el mundo en{' '}
              {organizationName} lo ve.
            </p>
            {!naming && (
              <button className="btn btn-primary btn-lg" onClick={() => setNaming(true)}>
                Empezar un proyecto
              </button>
            )}
          </div>
        ) : (
          <div className={s.projectsGrid}>
            {projects.map(p => (
              <div key={p.id} className={`card ${s.projectCard}`}>
                {/* A button rather than a clickable div: this is the way into the
                    project, and the way in should answer the keyboard. */}
                <button className={s.projectOpen} onClick={() => router.push(`/projects/${p.id}`)}>
                  <div className={s.projectName}>{p.name}</div>
                  <div className={s.projectMeta}>
                    {p.sequence_count} secuencia{p.sequence_count === 1 ? '' : 's'}
                    {p.cue_count > 0 && ` · ${p.cue_count.toLocaleString('es-ES')} cues`}
                  </div>
                  {p.target_langs.length > 0 && (
                    <div className={s.projectLangs}>{p.target_langs.map(short).join(' ')}</div>
                  )}
                </button>

                <div className={s.projectFoot}>
                  {/* Last activity anywhere inside, not the project row's own
                      timestamp — that only moves on a rename. */}
                  <span className="muted" suppressHydrationWarning>{ago(p.last_activity)}</span>
                  <div className={s.spacer} />
                  <button className="btn btn-danger" disabled={busyId === p.id} onClick={() => void remove(p)}>
                    {busyId === p.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Only once there is a past to look at: a table with one row in it is
            the card above, said twice. */}
        {usage.length > 1 && (
          <div className={`card ${s.history}`}>
            <div className="card-head">
              <span className="caps">Historial de uso</span>
            </div>
            {usage.map(m => (
              <div key={m.month} className="row">
                <span className={s.historyMonth}>{formatMonth(m.month)}</span>
                <span className="muted" style={{ fontFamily: 'var(--mono)' }}>
                  {formatDuration(m.transcribeSeconds)} de audio
                </span>
                <span className="muted" style={{ fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                  {m.translatedCues.toLocaleString('es-ES')} subtítulos
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/** One allowance, spent and remaining. The same thresholds the editor's
 *  pipeline warns on, so the two can never disagree about whether an
 *  allowance is nearly gone. */
function Meter({ used, total }: { used: number; total: number }) {
  const spent = Math.min(100, Math.round((used / total) * 100))
  const state = spent >= 100 ? 'none' : spent >= 80 ? 'low' : ''
  return (
    <div className="meter">
      <div className={`meter-fill ${state}`} style={{ width: `${spent}%` }} />
    </div>
  )
}
