import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { revokeEnrollKey } from "@/operations/enroll-keys"

/** Revokes one of a hive's enroll keys. What it enrolled stays enrolled. */
export async function POST(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (await request.json().catch(() => {
      throw new AppError("INVALID_INPUT", "Invalid JSON")
    })) as Record<string, unknown>
    if (
      !input ||
      typeof input.organizationId !== "string" ||
      typeof input.id !== "string"
    )
      throw new AppError("INVALID_INPUT", "Say which hive and which key")
    return Response.json(
      await revokeEnrollKey(
        {
          db: getDb(),
          actor: { userId: user.id, organizationId: input.organizationId },
        },
        { id: input.id }
      )
    )
  } catch (error) {
    logError(error, "enroll-keys.revoke")
    return errorResponse(error, requestId())
  }
}
