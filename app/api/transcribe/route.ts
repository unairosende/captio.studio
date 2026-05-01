import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', user.id)
    .single()

  if (!sub || sub.status !== 'active') {
    return NextResponse.json({ error: 'No active subscription' }, { status: 403 })
  }

  const formData = await req.formData()
  const xcProvider = formData.get('xcProvider') as string
  formData.delete('xcProvider')

  const key  = xcProvider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY
  const url  = xcProvider === 'openai'
    ? 'https://api.openai.com/v1/audio/transcriptions'
    : 'https://api.groq.com/openai/v1/audio/transcriptions'

  if (!key) return NextResponse.json({ error: 'Transcription provider not configured' }, { status: 500 })

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json({ error: err?.error?.message ?? `HTTP ${res.status}` }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
