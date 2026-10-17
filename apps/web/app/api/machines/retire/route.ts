import { authenticateMachine, revokeMachine } from "@workspace/db/machines"

import { getDb } from "@/db"
import { discardUnreadBody, logError, requestId } from "@/lib/diagnostics"
import { errorResponse } from "@/lib/errors"

/**
 * Retires the machine whose token asks: its token stops working and it
 * serves no hive. What `hived logout --revoke` does, so a machine being
 * wiped or handed on leaves no credential behind. Like leaving one hive,
 * this needs nobody at a browser; adding it back means enrolling again.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)
    const db = getDb()
    const machine = token ? await authenticateMachine(db, token[1]!) : null
    // Nothing in the body is used.
    await discardUnreadBody(request)
    if (!machine)
      return Response.json({ error: "Unknown machine" }, { status: 401 })
    await revokeMachine(db, machine.id)
    return Response.json(
      { retired: true, machineId: machine.id },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "machine.retire")
    return errorResponse(error, requestId())
  }
}
