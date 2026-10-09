import {
  authenticateMachine,
  listMachinePools,
  removeMachineFromPool,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { discardUnreadBody, logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"

/**
 * Stops a machine serving one hive, asked with its machine token: what
 * `hived unlink` does. A machine may always take itself out of a hive, so
 * unlike adding one this needs nobody at a browser.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)
    const db = getDb()
    const machine = token ? await authenticateMachine(db, token[1]!) : null
    if (!machine) {
      await discardUnreadBody(request)
      return Response.json({ error: "Unknown machine" }, { status: 401 })
    }
    const input = (await request.json()) as Record<string, unknown>
    if (typeof input.organizationId !== "string")
      throw new AppError("INVALID_INPUT", "Invalid input")
    if (
      !(await removeMachineFromPool(db, {
        machineId: machine.id,
        organizationId: input.organizationId,
      }))
    )
      throw new AppError("NOT_FOUND", "This machine does not serve that hive")
    return Response.json(
      {
        pools: (await listMachinePools(db, machine.id)).map(({ id, name }) => ({
          id,
          name,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "machine.unlink")
    return errorResponse(error, requestId())
  }
}
