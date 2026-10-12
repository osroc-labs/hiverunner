import {
  addMachinesToPool,
  MAX_MACHINES_PER_REQUEST,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { getGitHubApp } from "@/lib/github"

/**
 * Authorizes the caller's own machines for another pool: one as `machineId`,
 * or several as `machineIds`. Each is decided separately, and the answer says
 * which were added and why each of the others was not. It is an error only
 * when none was.
 */
export async function POST(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (await request.json()) as Record<string, unknown>
    const machineIds =
      input.machineIds === undefined ? [input.machineId] : input.machineIds
    if (
      typeof input.organizationId !== "string" ||
      !Array.isArray(machineIds) ||
      !machineIds.length ||
      machineIds.length > MAX_MACHINES_PER_REQUEST ||
      !machineIds.every((id): id is string => typeof id === "string")
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    const { added, refused } = await addMachinesToPool(
      getDb(),
      getGitHubApp(),
      { userId: user.id, machineIds, organizationId: input.organizationId }
    )
    if (!added.length) throw new AppError(refused[0]!.code, refused[0]!.message)
    return Response.json({ ok: true, added, refused })
  } catch (error) {
    logError(error, "machine.pool.add")
    return errorResponse(error, requestId())
  }
}
