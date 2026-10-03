import { getMembership, roleAtLeast } from "@workspace/auth"
import {
  getMachine,
  removeMachineFromPool,
  revokeMachine,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"

/**
 * With an `organizationId`: stop the machine serving that pool. Its owner or
 * an owner of the organization may. Without one: retire the machine and its
 * token everywhere, which only its owner may.
 */
export async function POST(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (await request.json()) as Record<string, unknown>
    if (
      typeof input.machineId !== "string" ||
      (input.organizationId !== undefined &&
        typeof input.organizationId !== "string")
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    const db = getDb()
    const machine = await getMachine(db, input.machineId)
    const mine = machine?.userId === user.id

    if (input.organizationId === undefined) {
      // The same answer whether it does not exist or is someone else's.
      if (!machine || !mine) throw new AppError("NOT_FOUND", "No such machine")
      await revokeMachine(db, machine.id)
      return Response.json({ ok: true })
    }

    const membership = await getMembership(db, {
      organizationId: input.organizationId,
      userId: user.id,
    })
    if (!machine || !membership)
      throw new AppError("NOT_FOUND", "No such machine")
    if (!mine && !roleAtLeast(membership.role, "owner"))
      throw new AppError(
        "FORBIDDEN",
        "Only the machine's owner or an organization owner can remove it"
      )
    if (
      !(await removeMachineFromPool(db, {
        machineId: machine.id,
        organizationId: input.organizationId,
      }))
    )
      throw new AppError("NOT_FOUND", "No such machine")
    return Response.json({ ok: true })
  } catch (error) {
    logError(error, "machine.revoke")
    return errorResponse(error, requestId())
  }
}
