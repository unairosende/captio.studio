'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PLANS } from '@/lib/plans'

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null)

  async function checkout(planId: string) {
    setLoading(planId)
    const res  = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId }) })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else { alert(data.error ?? 'Something went wrong'); setLoading(null) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', padding: '60px 24px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Link href="/" style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em', textDecoration: 'none', display: 'block', marginBottom: 24 }}>
            Captio
          </Link>
          <h1 style={{ fontSize: 36, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Simple, transparent pricing</h1>
          <p style={{ fontSize: 16, color: 'var(--text2)', lineHeight: 1.6 }}>
            All plans include every feature. No per-translation fees, no surprises.
          </p>
        </div>

        {/* Plans */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
          {PLANS.map((plan, i) => (
            <div key={plan.id} style={{ background: 'var(--bg1)', border: `1px solid ${i === 1 ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
              {i === 1 && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                  Most popular
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{plan.name}</div>
              <div style={{ marginBottom: 24 }}>
                <span style={{ fontSize: 42, fontWeight: 700, color: 'var(--text)' }}>${plan.price}</span>
                <span style={{ fontSize: 14, color: 'var(--text3)' }}>/month</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32, flex: 1 }}>
                {[
                  `${(plan.monthlySubtitles / 1000).toFixed(0)}K subtitles / month`,
                  `${plan.seats} seat${plan.seats > 1 ? 's' : ''}`,
                  'All AI providers',
                  'Back-translation QA',
                  'SRT · TXT · CSV · VTT export',
                  'Video burn-in (coming soon)',
                ].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text2)' }}>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button
                onClick={() => checkout(plan.id)}
                disabled={!!loading}
                style={{ padding: '12px 0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', border: 'none', background: i === 1 ? 'var(--accent)' : 'var(--bg2)', color: i === 1 ? '#fff' : 'var(--text)', opacity: loading ? .6 : 1, transition: 'all .15s' }}
              >
                {loading === plan.id ? 'Redirecting…' : `Get ${plan.name}`}
              </button>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text3)', lineHeight: 1.8 }}>
          Billed monthly · Cancel anytime · 2.9% + 30¢ processing fee via Stripe<br />
          Questions? <a href="mailto:hello@captio.studio" style={{ color: 'var(--accent)', textDecoration: 'none' }}>hello@captio.studio</a>
        </div>
      </div>
    </div>
  )
}
