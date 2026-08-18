import { NextResponse } from 'next/server'

import { authErrorResponse, isAdmin, requireOrgContext } from '@/lib/auth/session'
import { getStripeCustomerId } from '@/lib/db/billing'
import { getStripe } from '@/lib/stripe'

/**
 * Send an admin to Stripe's own billing portal.
 *
 * Invoices, the saved card and cancellation all live there rather than here.
 * Rebuilding them would mean holding a second copy of what Stripe already knows,
 * and the copy is wrong from the first webhook that arrives out of order — while
 * a customer with no way to cancel has to email us to stop paying, which is not
 * a subscription anybody should be asked to trust.
 *
 * Same guard as checkout: the customer is the organisation, and only an owner or
 * admin may act for it.
 */
export async function POST() {
  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (err) {
    return authErrorResponse(err)
  }

  if (!isAdmin(ctx)) {
    return NextResponse.json(
      { error: 'Only an owner or admin can manage billing' },
      { status: 403 },
    )
  }

  // Deliberately not created on demand. A portal for a customer who has never
  // paid shows an empty page with a cancel button for nothing; whoever is
  // asking wants /pricing, and saying so is more use than opening it.
  const customerId = await getStripeCustomerId(ctx.orgId)
  if (!customerId) {
    return NextResponse.json({ error: 'No billing account yet' }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    // The portal needs its configuration saved in the Stripe dashboard before
    // it will open, once per mode — and test mode counts as its own. Stripe says
    // exactly that, so the message is worth more to whoever hit it than the 500
    // an unhandled throw would return as HTML to a caller parsing JSON.
    const message = err instanceof Error ? err.message : 'Could not open the billing portal'
    console.error('billing portal', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
