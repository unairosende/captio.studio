import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Provider = 'gemini' | 'groq' | 'openrouter' | 'mistral'

const ENDPOINTS: Record<Provider, string> = {
  gemini:      '',  // built per-request with model + key
  groq:        'https://api.groq.com/openai/v1/chat/completions',
  openrouter:  'https://openrouter.ai/api/v1/chat/completions',
  mistral:     'https://api.mistral.ai/v1/chat/completions',
}

const PROVIDER_KEYS: Record<Provider, string> = {
  gemini:     process.env.GEMINI_API_KEY      ?? '',
  groq:       process.env.GROQ_API_KEY        ?? '',
  openrouter: process.env.OPENROUTER_API_KEY  ?? '',
  mistral:    process.env.MISTRAL_API_KEY     ?? '',
}

async function callProvider(provider: Provider, model: string, prompt: string): Promise<string> {
  const key = PROVIDER_KEYS[provider]
  if (!key) throw new Error(`Provider ${provider} not configured`)

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    const res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  }

  const res = await fetch(ENDPOINTS[provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
  return data?.choices?.[0]?.message?.content ?? '[]'
}

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Subscription check
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, plan, current_period_end')
    .eq('user_id', user.id)
    .single()

  if (!sub || sub.status !== 'active') {
    return NextResponse.json({ error: 'No active subscription' }, { status: 403 })
  }

  const body = await req.json()
  const { provider, model, prompt } = body as { provider: Provider; model: string; prompt: string }

  try {
    const text = await callProvider(provider, model, prompt)
    return NextResponse.json({ text })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
