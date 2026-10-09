import { logError, logEvent } from "@/lib/diagnostics"
import { requireMembership } from "@workspace/auth"

import { getDb } from "@/db"
import { getServerSession } from "@/lib/session"
import { canTakeCards, stripe } from "@/lib/stripe"
import { confirmCheckout } from "@/operations/top-up"

/**
 * Checks a card payment with Stripe when its event has not arrived.
 *
 * The wallet calls this for the Checkout it just came back from. The body
 * names that Checkout and nothing else: whether it was paid, how much, and
 * whose it is are all read from Stripe.
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
    checkout?: unknown
  }
  const checkoutId = body.checkout
  if (typeof checkoutId !== "string" || !/^cs_\w+$/.test(checkoutId))
    return Response.json({ error: "Unknown payment" }, { status: 400 })

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
    const outcome = await confirmCheckout(db, stripe(), {
      organizationId,
      checkoutId,
    })
    if (outcome === null)
      return Response.json({ error: "Unknown payment" }, { status: 404 })
    // The event should have done this. Crediting here means it was late,
    // lost or refused, and automatic top-ups have no other way in.
    if (outcome === "credited")
      logEvent("operation.failed", {
        operation: "stripe.webhook",
        code: "credited_without_event",
      })
    return Response.json({ credited: outcome !== "ignored" })
  } catch (error) {
    logError(error, "wallet.top-up.confirm")
    return Response.json(
      { error: "Could not check the payment." },
      { status: 502 }
    )
  }
}
