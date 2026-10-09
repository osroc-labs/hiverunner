import { logError } from "@/lib/diagnostics"
import { requireMembership } from "@workspace/auth"
import {
  TOP_UP_AMOUNTS_USD,
  TOP_UP_MAX_USD,
  TOP_UP_MIN_USD,
  topUpAllowed,
} from "@workspace/pricing"
import {
  createCheckoutSession,
  ensureCustomer,
  StripeError,
} from "@workspace/stripe"
import {
  getCustomerByOrganization,
  upsertCustomer,
} from "@workspace/stripe/store"

import { getDb } from "@/db"
import { getServerSession } from "@/lib/session"
import { appOrigin, canTakeCards, stripe } from "@/lib/stripe"

/**
 * Starts a card payment that adds to the active organization's balance.
 *
 * The body names a whole number of dollars within the limits this app sets
 * and nothing else. The balance is credited by the webhook when Stripe says the payment was made,
 * not by the browser coming back from Checkout.
 */
export async function POST(request: Request) {
  if (!canTakeCards())
    return Response.json(
      { error: "Card payments are not set up yet." },
      { status: 503 }
    )
  const session = await getServerSession()
  if (!session)
    return Response.json({ error: "Not signed in" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return Response.json({ error: "No active organization" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as {
    amount?: unknown
    auto?: unknown
  }
  if (!topUpAllowed(body.amount))
    return Response.json(
      {
        error: `Choose a whole number of dollars from $${TOP_UP_MIN_USD} to $${TOP_UP_MAX_USD.toLocaleString("en-US")}.`,
      },
      { status: 400 }
    )
  const dollars = body.amount
  // Asked for by the person paying, and never assumed for them. Automatic
  // top-up charges only the amounts on offer, so an amount of the payer's
  // own is a one-off.
  const auto =
    body.auto === true &&
    TOP_UP_AMOUNTS_USD.some((offered) => offered === dollars)

  const db = getDb()
  // Checked against the database, not the session: someone removed from the
  // organization keeps a stale session until it refreshes.
  try {
    await requireMembership(db, {
      organizationId,
      userId: session.user.id,
      role: "admin",
    })
  } catch {
    return Response.json(
      { error: "Only an owner or admin can add funds." },
      { status: 403 }
    )
  }

  try {
    const client = stripe()
    const customer = await ensureCustomer(client, {
      organizationId,
      email: session.user.email,
      name: session.user.name,
      lookup: async () =>
        (
          await getCustomerByOrganization(
            db,
            organizationId,
            client.config.livemode
          )
        )?.id ?? null,
      persist: (id) =>
        upsertCustomer(db, {
          id,
          organizationId,
          email: session.user.email,
          livemode: client.config.livemode,
        }),
    })
    const origin = appOrigin(request)
    const checkout = await createCheckoutSession(client, {
      mode: "payment",
      customer,
      lineItems: [
        {
          priceData: {
            currency: "usd",
            unitAmount: dollars * 100,
            productName: "HiveWorker credit",
            productDescription: "Pays for GitHub Actions minutes on your hive.",
          },
        },
      ],
      // Stripe fills in the session, so the wallet can say when this one
      // payment has landed rather than guess.
      successUrl: `${origin}/wallet?funded=${dollars}&checkout={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/wallet`,
      clientReferenceId: organizationId,
      metadata: {
        organization_id: organizationId,
        kind: "top-up",
        amount_usd: String(dollars),
        ...(auto ? { auto: "1" } : {}),
      },
      extraParams: {
        // Cards only, so a completed Checkout is a completed payment.
        payment_method_types: ["card"],
        // Saved for later charges only when automatic top-up was asked for.
        ...(auto
          ? { payment_intent_data: { setup_future_usage: "off_session" } }
          : {}),
      },
    })
    return Response.json({ url: checkout.url })
  } catch (error) {
    const message =
      error instanceof StripeError
        ? error.message
        : "Could not start the payment. Please try again."
    logError(error, "wallet.top-up")
    return Response.json({ error: message }, { status: 502 })
  }
}
