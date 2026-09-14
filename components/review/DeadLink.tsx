/**
 * A review link that opens nothing.
 *
 * One page for a revoked link, an expired one and one that never existed:
 * saying which would tell a stranger which tokens were once real.
 */
export default function DeadLink() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 380 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em', marginBottom: 10 }}>
          Captio
        </div>
        <div style={{ fontSize: 15, color: 'var(--text)' }}>This link is no longer active.</div>
        <div className="muted" style={{ marginTop: 5 }}>
          Ask whoever sent it to you for a new one.
        </div>
      </div>
    </div>
  )
}
