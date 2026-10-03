import { listOrganizations } from "@workspace/auth"
import {
  endSession,
  enrollMachine,
  type MachineFacts,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { apiSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { getGitHubApp } from "@/lib/github"

/**
 * Enrolls the caller's machine in a pool and returns its token, once.
 *
 * Called by the daemon right after device sign-in. The sign-in session is
 * ended here: from now on the machine token is the daemon's only credential,
 * so a person's session expiring never takes their machine offline.
 */
export async function POST(request: Request) {
  try {
    const { user, session, bearer } = await apiSession(request)
    const input = (await request.json()) as Record<string, unknown>
    const db = getDb()

    let organizationId = input.organizationId
    if (organizationId === undefined) {
      const pools = await listOrganizations(db, user.id)
      if (pools.length !== 1)
        // The daemon shows this list and asks again with a choice.
        return Response.json(
          {
            error: pools.length
              ? "Choose a pool"
              : "You are not a member of any pool",
            code: pools.length ? "CHOOSE_POOL" : "FORBIDDEN",
            pools: pools.map(({ id, name }) => ({ id, name })),
          },
          { status: pools.length ? 409 : 403 }
        )
      organizationId = pools[0]!.id
    }
    if (typeof organizationId !== "string")
      throw new AppError("INVALID_INPUT", "Invalid input")

    const result = await enrollMachine(db, getGitHubApp(), {
      userId: user.id,
      organizationId,
      facts: input as unknown as MachineFacts,
    })
    if (!result.ok)
      throw new AppError(result.code, result.message, result.fields)
    if (bearer) await endSession(db, session.id)
    return Response.json(
      { machineId: result.machineId, organizationId, token: result.token },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "machine.enroll")
    return errorResponse(error, requestId())
  }
}
