import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TranslateClient from './TranslateClient'

export default async function TranslatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, plan')
    .eq('user_id', user.id)
    .single()

  if (!sub || sub.status !== 'active') redirect('/pricing')

  return <TranslateClient user={{ email: user.email ?? '' }} plan={sub.plan} />
}
