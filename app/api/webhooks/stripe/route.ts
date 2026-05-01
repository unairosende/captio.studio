import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const sub   = event.data.object as Stripe.Subscription
  const admin = getAdmin()

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated'
  ) {
    const userId = sub.metadata?.user_id
    if (!userId) return NextResponse.json({ error: 'No user_id in metadata' }, { status: 400 })

    await admin.from('subscriptions').upsert({
      id:                  sub.id,
      user_id:             userId,
      status:              sub.status,
      plan:                sub.metadata?.plan_id ?? 'individual',
      current_period_end:  new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString(),
    })
  }

  if (event.type === 'customer.subscription.deleted') {
    await admin.from('subscriptions').update({ status: 'canceled' }).eq('id', sub.id)
  }

  return NextResponse.json({ received: true })
}
