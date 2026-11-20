import { NextResponse, type NextRequest } from 'next/server'

import { authErrorResponse, isAdmin, requireOrgContext, requireUser } from '@/lib/auth/session'
import { latestSubscription } from '@/lib/db/billing'
import { PLANS } from '@/lib/plans'
import { getStripe } from '@/lib/stripe'

/**
 * Statuses Stripe still bills, or will once the card is fixed. `past_due` and
 * `unpaid` are not live for entitlement, but they are very much alive at Stripe.
 */
const BILLABLE: string[] = ['active', 'trialing', 'past_due', 'unpaid']

/**
 * Start a checkout for the organisation.
 *
 * The customer is the organisation, never the person clicking. A productora
 * that changes hands, or whose owner leaves, must keep its billing history and
 * its saved card.
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  // Anyone in the organisation could otherwise commit it to a monthly bill.
  if (!isAdmin(ctx)) {
    return NextResponse.json(
      { error: 'Only an owner or admin can change the subscription' },
      { status: 403 },
    )
  }

  const { planId } = await req.json()
  const plan = PLANS.find(p => p.id === planId)
  if (!plan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  if (!plan.stripePriceId) {
    return NextResponse.json({ error: `Plan ${plan.id} has no Stripe price` }, { status: 500 })
  }

  // Checkout always opens a NEW subscription. For an organisation that already
  // pays, that is a second one billed every month next to the first; changing
  // plan belongs to the portal, which swaps the price on the one it has.
  const current = await latestSubscription(ctx.orgId)
  if (current && BILLABLE.includes(current.status)) {
    return NextResponse.json(
      { error: 'Organisation already has a subscription; change plan from the billing portal' },
      { status: 409 },
    )
  }

  const stripe = getStripe()

  // Any status will do: a cancelled subscription still names the customer, and
  // a second customer would split the billing history and the saved card.
  let customerId = current?.stripe_customer_id ?? null
  if (!customerId) {
    // Whoever is paying, so checkout does not ask for an address we already have
    // and the invoices reach somebody; they can change it later in the portal.
    const { email } = await requireUser()
    const customer = await stripe.customers.create({
      email,
      metadata: { org_id: ctx.orgId },
    })
    customerId = customer.id
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${appUrl}/translate?checkout=success`,
    cancel_url: `${appUrl}/pricing`,
    // This has to go on subscription_data, not on the session. Session metadata
    // stays on the Session object; the webhook listens for
    // customer.subscription.created and reads the Subscription's own metadata.
    // Putting it on the session is why the old webhook could never find it.
    subscription_data: {
      metadata: { org_id: ctx.orgId, plan_id: plan.id },
    },
  })

  return NextResponse.json({ url: session.url })
}
