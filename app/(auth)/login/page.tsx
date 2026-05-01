'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/translate')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em', marginBottom: 8 }}>
            Captio
          </div>
          <div style={{ fontSize: 14, color: 'var(--text2)' }}>Sign in to your account</div>
        </div>

        <form onSubmit={handleSubmit} style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }} />
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 6 }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ padding: '10px 0', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', border: 'none', background: 'var(--accent)', color: '#fff', opacity: loading ? .6 : 1, transition: 'all .15s' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Sign up</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
