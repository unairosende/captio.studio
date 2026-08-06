import type { CSSProperties, ReactNode } from 'react'

/**
 * Shared shell for the signed-out screens.
 *
 * Login, sign-up and onboarding had the same 35 lines of markup between them;
 * one copy means they cannot drift apart visually.
 */

export const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 12px',
  color: 'var(--text)',
  fontSize: 14,
  outline: 'none',
}

export const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  display: 'block',
  marginBottom: 6,
}

export function buttonStyle(busy: boolean): CSSProperties {
  return {
    padding: '10px 0',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: busy ? 'not-allowed' : 'pointer',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    opacity: busy ? 0.6 : 1,
    transition: 'all .15s',
  }
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div
      role="alert"
      style={{
        fontSize: 12,
        color: 'var(--red)',
        padding: '8px 12px',
        background: 'var(--red-dim)',
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  )
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--accent)',
              letterSpacing: '.04em',
              marginBottom: 8,
            }}
          >
            Captio
          </div>
          <div style={{ fontSize: 14, color: 'var(--text2)' }}>{subtitle}</div>
        </div>

        <div
          style={{
            background: 'var(--bg1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 28,
          }}
        >
          <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 18 }}>{title}</h1>
          {children}
        </div>

        {footer && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text3)',
              textAlign: 'center',
              marginTop: 18,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
