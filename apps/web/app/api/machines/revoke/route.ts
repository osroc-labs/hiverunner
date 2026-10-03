import { getMembership, roleAtLeast } from "@workspace/auth"
import { getMachine, revokeMachine } from "@workspace/db/machines"

import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"

export async function POST(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (await request.json()) as { machineId?: unknown }
    if (typeof input.machineId !== "string")
      throw new AppError("INVALID_INPUT", "Invalid input")
    const db = getDb()
    const machine = await getMachine(db, input.machineId)
    const membership = machine
      ? await getMembership(db, {
          organizationId: machine.organizationId,
          userId: user.id,
        })
      : null
    // The same answer whether it does not exist or is not theirs to see.
    if (!machine || !membership)
      throw new AppError("NOT_FOUND", "No such machine")
    if (machine.userId !== user.id && !roleAtLeast(membership.role, "owner"))
      throw new AppError(
        "FORBIDDEN",
        "Only the machine's owner or an organization owner can remove it"
      )
    await revokeMachine(db, machine.id)
    return Response.json({ ok: true })
  } catch (error) {
    logError(error, "machine.revoke")
    return errorResponse(error, requestId())
  }
}
