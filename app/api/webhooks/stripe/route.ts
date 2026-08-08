import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'

import { upsertSubscription, type SubscriptionStatus } from '@/lib/db/billing'
import { PLANS } from '@/lib/plans'
import { getStripe } from '@/lib/stripe'

/**
 * Stripe's view of what an organisation owes, written into ours.
 *
 * The signature is the authentication here — there is no session. The route is
 * therefore exempt from the middleware, and the check below is the only thing
 * standing between this endpoint and anyone who can guess the URL.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set; refusing the webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Must be the raw body: any reserialisation changes the bytes the signature
  // was computed over.
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (
    event.type !== 'customer.subscription.created' &&
    event.type !== 'customer.subscription.updated' &&
    event.type !== 'customer.subscription.deleted'
  ) {
    // Acknowledge anything else, or Stripe retries it forever.
    return NextResponse.json({ received: true })
  }

  const sub = event.data.object as Stripe.Subscription

  const orgId = sub.metadata?.org_id
  if (!orgId) {
    // Written by checkout into subscription_data.metadata. Missing means the
    // subscription was created outside our flow, and we cannot guess whose it
    // is — 400 so it surfaces in Stripe's dashboard instead of vanishing.
    console.error('subscription without org_id metadata', sub.id)
    return NextResponse.json({ error: 'No org_id in subscription metadata' }, { status: 400 })
  }

  const planId = sub.metadata?.plan_id ?? 'individual'
  const seats = PLANS.find(p => p.id === planId)?.seats ?? 1

  // Stripe moved the period end onto the subscription items; older API versions
  // keep it on the subscription. Read both rather than depend on which version
  // this account is pinned to.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end

  await upsertSubscription({
    id: sub.id,
    orgId,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    // A deleted subscription still arrives with its last status; what matters
    // for access is that it is no longer live.
    status:
      event.type === 'customer.subscription.deleted'
        ? 'canceled'
        : (sub.status as SubscriptionStatus),
    plan: planId,
    seats,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  })

  return NextResponse.json({ received: true })
}
