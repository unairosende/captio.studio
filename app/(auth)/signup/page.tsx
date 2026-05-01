'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/translate` },
    })
    if (error) { setError(error.message); setLoading(false); return }
    setDone(true)
  }

  if (done) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
        <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Check your email</div>
        <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>We sent a confirmation link to <b>{email}</b>. Click it to activate your account, then choose a plan.</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em', marginBottom: 8 }}>
            Captio
          </div>
          <div style={{ fontSize: 14, color: 'var(--text2)' }}>Create your account</div>
        </div>

        <form onSubmit={handleSubmit} style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }} />
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 6 }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ padding: '10px 0', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', border: 'none', background: 'var(--accent)', color: '#fff', opacity: loading ? .6 : 1, transition: 'all .15s' }}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
