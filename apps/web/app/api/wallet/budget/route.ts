import { requireMembership } from "@workspace/auth"
import { budgetAllowed, setBudget } from "@workspace/db/budget"
import { BUDGET_MAX_USD } from "@workspace/pricing"

import { getDb } from "@/db"
import { logError } from "@/lib/diagnostics"
import { getServerSession } from "@/lib/session"

/**
 * Sets, changes or removes the active organization's monthly budget for
 * jobs. A `budget` of null removes it.
 */
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session)
    return Response.json({ error: "Not signed in" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return Response.json({ error: "No active organization" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as {
    budget?: unknown
    atLimit?: unknown
  }
  if (body.budget !== null && !budgetAllowed(body.budget))
    return Response.json(
      {
        error: `A budget is a whole number of dollars from $1 to $${BUDGET_MAX_USD.toLocaleString("en-US")}.`,
      },
      { status: 400 }
    )
  if (
    body.budget !== null &&
    body.atLimit !== "warn" &&
    body.atLimit !== "pause"
  )
    return Response.json(
      { error: "Choose what happens at the limit." },
      { status: 400 }
    )

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
      { error: "Only an owner or admin can set a budget." },
      { status: 403 }
    )
  }
  try {
    await setBudget(db, {
      organizationId,
      dollars: body.budget,
      atLimit: body.atLimit === "pause" ? "pause" : "warn",
    })
    return Response.json({ ok: true })
  } catch (error) {
    logError(error, "wallet.budget")
    return Response.json(
      { error: "Could not save the budget. Please try again." },
      { status: 500 }
    )
  }
}
