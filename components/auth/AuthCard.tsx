import Link from 'next/link'
import type { InputHTMLAttributes, ReactNode } from 'react'

import s from './auth.module.css'

/**
 * Shared shell for the signed-out screens.
 *
 * Login, sign-up, the two password screens, the invitation and onboarding all
 * draw the same thing — the brand, a card, a line under it — so it is drawn
 * once. The form pieces are the library's own; what lives here is only the
 * label above a field and the line an error is printed on, which no other
 * screen needs.
 */

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
    <div className={`v2 ${s.page}`}>
      <div className={s.column}>
        <div className={s.head}>
          <Link href="/" className="brand">captio</Link>
          <p className={s.subtitle}>{subtitle}</p>
        </div>

        <div className={`card ${s.card}`}>
          <h1 className={s.title}>{title}</h1>
          {children}
        </div>

        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </div>
  )
}

/** The stacked fields of one of these forms, with the room they need. */
export function AuthForm({ onSubmit, children }: { onSubmit: (e: React.FormEvent) => void; children: ReactNode }) {
  return <form onSubmit={onSubmit} className={s.form}>{children}</form>
}

/** A labelled field, and the one line under it when there is something to say. */
export function Field({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className={s.label}>{label}</label>
      <input id={id} className="field" {...input} />
      {hint && <div className="field-msg">{hint}</div>}
    </div>
  )
}

/** Two buttons, one above the other. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className={s.actions}>{children}</div>
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="err" role="alert">{children}</p>
}
