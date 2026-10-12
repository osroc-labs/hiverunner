import { setMachineAutoJoin } from "@workspace/db/machines"

import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { discardUnreadBody, logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"

/**
 * Turns auto-join on or off for one of the caller's own machines.
 *
 * This is standing consent to take other organizations' jobs, so it is given
 * by a person at a browser and by nothing else. Better Auth would accept a
 * daemon's sign-in token as a session, and a daemon can send any Origin it
 * likes, so a request carrying an Authorization header is refused outright.
 */
export async function POST(request: Request) {
  try {
    if (request.headers.has("authorization")) {
      await discardUnreadBody(request)
      throw new AppError("FORBIDDEN", "Change this from a browser")
    }
    const { user } = await browserSession(request)
    const input = (await request.json()) as Record<string, unknown>
    if (
      typeof input.machineId !== "string" ||
      typeof input.autoJoin !== "boolean"
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    const refusal = await setMachineAutoJoin(getDb(), {
      userId: user.id,
      machineId: input.machineId,
      autoJoin: input.autoJoin,
    })
    if (refusal) throw new AppError(refusal.code, refusal.message)
    return Response.json({ ok: true })
  } catch (error) {
    logError(error, "machine.auto-join.set")
    return errorResponse(error, requestId())
  }
}
