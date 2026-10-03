import { addMachineToPool } from "@workspace/db/machines"

import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { getGitHubApp } from "@/lib/github"

/** Authorizes one of the caller's own machines for another pool. */
export async function POST(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (await request.json()) as Record<string, unknown>
    if (
      typeof input.machineId !== "string" ||
      typeof input.organizationId !== "string"
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    const refusal = await addMachineToPool(getDb(), getGitHubApp(), {
      userId: user.id,
      machineId: input.machineId,
      organizationId: input.organizationId,
    })
    if (refusal) throw new AppError(refusal.code, refusal.message)
    return Response.json({ ok: true })
  } catch (error) {
    logError(error, "machine.pool.add")
    return errorResponse(error, requestId())
  }
}
