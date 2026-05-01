import Link from 'next/link'

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', color: 'var(--text)' }}>

      {/* Nav */}
      <nav style={{ padding: '16px 32px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg1)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/pricing" style={{ fontSize: 13, color: 'var(--text2)', textDecoration: 'none', padding: '6px 14px', borderRadius: 6 }}>Pricing</Link>
          <Link href="/login"   style={{ fontSize: 13, color: 'var(--text2)', textDecoration: 'none', padding: '6px 14px', borderRadius: 6 }}>Sign in</Link>
          <Link href="/signup"  style={{ fontSize: 13, color: '#fff', textDecoration: 'none', padding: '6px 16px', borderRadius: 6, background: 'var(--accent)', fontWeight: 500 }}>Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '96px 24px 72px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 20, background: 'var(--accent-dim)', border: '1px solid var(--accent)', fontSize: 12, color: '#8ba8ff', fontFamily: 'var(--mono)', marginBottom: 28 }}>
          AI-powered · no API keys · from $19/mo
        </div>
        <h1 style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.1, marginBottom: 20, letterSpacing: '-.02em' }}>
          Professional subtitle<br />
          <span style={{ color: 'var(--accent)' }}>translation at scale</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--text2)', lineHeight: 1.7, maxWidth: 560, margin: '0 auto 40px' }}>
          Translate subtitles with AI, verify quality with back-translation diff, and export in any format — without managing API keys.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/signup" style={{ fontSize: 15, fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '13px 28px', borderRadius: 8, background: 'var(--accent)' }}>
            Start free trial
          </Link>
          <Link href="/pricing" style={{ fontSize: 15, fontWeight: 500, color: 'var(--text2)', textDecoration: 'none', padding: '13px 28px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)' }}>
            See pricing
          </Link>
        </div>
      </div>

      {/* Feature grid */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 96px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { icon: '⇄', title: 'Multi-provider AI',    body: 'Gemini, Groq, OpenRouter, Mistral — we manage the keys, you pick the model.' },
            { icon: '↩', title: 'Back-translation QA',  body: 'Translate back to source and see word-level diffs to catch errors instantly.' },
            { icon: '✦', title: 'Auto-fix overlength',  body: 'Smart reflow finds the most balanced line split in one click, no AI credits burned.' },
            { icon: '🎙', title: 'Transcription',        body: 'Drop a video or audio file — Whisper extracts and timestamps every subtitle.' },
            { icon: '↓', title: 'SRT · VTT · CSV · TXT',body: 'Export in any broadcast format, horizontal or vertical split layout.' },
            { icon: '👥', title: 'Team plans',           body: 'Up to 5 seats on one subscription with a shared monthly usage pool.' },
          ].map(f => (
            <div key={f.title} style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
