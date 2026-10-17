import { getDb } from "@/db"
import { browserSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { createEnrollKey, listEnrollKeys } from "@/operations/enroll-keys"

/**
 * A hive's enroll keys, for its owners and admins at a browser: GET lists
 * them, POST mints one and returns it, once. An agent does the same through
 * MCP. `organizationId` says which hive, and membership is checked again.
 */
async function handle(request: Request) {
  try {
    const { user } = await browserSession(request)
    const input = (
      request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams)
        : await request.json().catch(() => {
            throw new AppError("INVALID_INPUT", "Invalid JSON")
          })
    ) as Record<string, unknown>
    if (!input || typeof input.organizationId !== "string")
      throw new AppError("INVALID_INPUT", "Choose a hive")
    const context = {
      db: getDb(),
      actor: { userId: user.id, organizationId: input.organizationId },
    }
    if (request.method === "GET")
      return Response.json(await listEnrollKeys(context), {
        headers: { "Cache-Control": "no-store" },
      })
    const { description, expiresInHours, maxUses } = input
    const is = (value: unknown, type: string) =>
      value === undefined || typeof value === type
    if (
      !is(description, "string") ||
      !is(expiresInHours, "number") ||
      !(maxUses === null || is(maxUses, "number"))
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    return Response.json(
      await createEnrollKey(context, {
        description: description as string | undefined,
        expiresInHours: expiresInHours as number | undefined,
        maxUses: maxUses as number | null | undefined,
      }),
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "enroll-keys")
    return errorResponse(error, requestId())
  }
}
export const GET = handle
export const POST = handle
