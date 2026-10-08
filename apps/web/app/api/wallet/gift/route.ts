import { requireMembership } from "@workspace/auth"
import { countGifts, openGift } from "@workspace/db/gift"

import { getDb } from "@/db"
import { logError } from "@/lib/diagnostics"
import { getServerSession } from "@/lib/session"
import { canTakeCards } from "@/lib/stripe"

/**
 * The gift that comes with a card payment: how many are waiting, and opening
 * one.
 *
 * Opening takes no body. Which payment the gift belongs to and what is in it
 * are both decided here; the browser only asks, and then draws the answer.
 */

/** The organization of someone who may pay for it, or the refusal. */
async function payer() {
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
      { error: "Only an owner or admin can open a gift." },
      { status: 403 }
    )
  }
  return { db, organizationId }
}

export async function GET() {
  const who = await payer()
  if (who instanceof Response) return who
  return Response.json({
    waiting: await countGifts(who.db, who.organizationId),
  })
}

export async function POST() {
  const who = await payer()
  if (who instanceof Response) return who
  try {
    const gift = await openGift(who.db, { organizationId: who.organizationId })
    if (!gift)
      return Response.json(
        { error: "There is no gift waiting. It may already have been opened." },
        { status: 409 }
      )
    return Response.json(gift)
  } catch (error) {
    logError(error, "wallet.gift")
    return Response.json(
      { error: "Could not open the gift. Please try again." },
      { status: 500 }
    )
  }
}
