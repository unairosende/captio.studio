'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AuthCard, AuthForm, Field, FormError } from '@/components/auth/AuthCard'
import { organization } from '@/lib/auth/client'

/** Name → URL-safe slug. Accents are folded so "Producciones Ñ" stays readable. */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function CreateOrganization({ suggestedName }: { suggestedName: string }) {
  const [name, setName] = useState(suggestedName)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const base = slugify(name) || 'productora'

    // Slugs are unique across every customer, so a common name will collide
    // sooner or later. One retry with a random suffix beats making the person
    // invent a name the database happens to accept.
    let created = await organization.create({ name, slug: base })
    if (created.error) {
      const suffix = Math.random().toString(36).slice(2, 6)
      created = await organization.create({ name, slug: `${base}-${suffix}` })
    }

    if (created.error || !created.data) {
      setError(created.error?.message ?? 'No se pudo crear la organización.')
      setLoading(false)
      return
    }

    // Without this the session has no active organisation and the app layout
    // would send them straight back here.
    await organization.setActive({ organizationId: created.data.id })

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <AuthCard title="Crea tu organización" subtitle="Un último paso">
      <AuthForm onSubmit={handleSubmit}>
        <p>
          Tus proyectos, tu equipo y tu facturación viven dentro de una organización. Suele ser el
          nombre de tu productora.
        </p>
        <Field
          id="org"
          label="Nombre"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Mi productora"
          required
          maxLength={80}
          autoFocus
        />

        <FormError>{error}</FormError>

        <button type="submit" className="btn btn-primary btn-lg" disabled={!name.trim()} aria-busy={loading || undefined}>
          Crear organización
        </button>
      </AuthForm>
    </AuthCard>
  )
}
