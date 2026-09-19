'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import m from '@/components/marketing/marketing.module.css'
import { send } from '@/lib/api'
import { PLANS, TRIAL } from '@/lib/plans'

/**
 * The three cards, and the way into Stripe.
 *
 * Checkout needs a session and an owner or admin behind it. Somebody signed
 * out is sent to log in and brought back here; somebody without the right is
 * told so in a line under the button — an alert() is the one thing the page
 * must not do, because a browser that has learnt to block it leaves a button
 * that silently does nothing.
 */
export default function Plans() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function checkout(planId: string) {
    setBusy(planId)
    setError(null)

    const r = await send<{ url?: string }>('/api/checkout', { planId })

    if (r.status === 401) {
      router.push('/login?next=/pricing')
      return
    }
    if (r.ok && r.json.url) {
      // Left busy on purpose: the navigation is already happening.
      window.location.assign(r.json.url)
      return
    }
    setError(
      r.status === 403
        ? 'Solo un propietario o administrador de la organización puede cambiar la suscripción.'
        : r.error,
    )
    setBusy(null)

  }

  return (
    <>
      <div className={m.plans}>
        <div className={`card ${m.plan}`}>
          <span className="caps">Prueba</span>
          <div className={m.price}>0 €</div>
          <p className={m.planLine}>Sin tarjeta. Una cantidad, no una quincena.</p>
          <ul className={m.features}>
            <li><strong>{TRIAL.mediaMinutes} minutos</strong> de material</li>
            <li>Transcrito, subtitulado y traducido a todos los idiomas que necesites</li>
            <li>Todo lo que hace Captio, sin recortes</li>
            <li>Cuando se agota, lo hecho se queda y sigue exportándose</li>
          </ul>
          <Link href="/signup" className="btn btn-primary btn-lg">Empezar gratis</Link>
        </div>

        {PLANS.map(plan => (
          <div key={plan.id} className={`card ${m.plan}`}>
            <span className="caps">{plan.name}</span>
            <div className={m.price}>{plan.price} €<span className={m.per}>/mes</span></div>
            <p className={m.planLine}>{plan.seats === 1 ? 'Una persona' : `Hasta ${plan.seats} personas`}</p>
            <ul className={m.features}>
              <li><strong>{plan.monthlyMediaMinutes / 60} horas</strong> de material al mes</li>
              {/* The line that does the selling. Every competitor charges per
                  language; translating one episode into six costs us about
                  seventy cents more than into one, so this is a promise we can
                  afford to keep and they cannot afford to match. */}
              <li>Todos los idiomas incluidos, sin tarifa por idioma</li>
              <li>{plan.seats === 1 ? 'Una plaza' : `${plan.seats} plazas con una cuota compartida`}</li>
              <li>Control de calidad, retrotraducción y glosario por proyecto</li>
              <li>Revisión del cliente por enlace, con versiones</li>
              <li>SRT · VTT · ASS · TTML · CSV</li>
            </ul>
            <button className="btn btn-lg" disabled={busy !== null && busy !== plan.id} aria-busy={busy === plan.id || undefined} onClick={() => void checkout(plan.id)}>
              Elegir {plan.name}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 'var(--sp-3)' }}>{error}</p>}
    </>
  )
}
