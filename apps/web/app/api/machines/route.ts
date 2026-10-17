import { listOrganizations } from "@workspace/auth"
import { enrollWithKey } from "@workspace/db/enroll-keys"
import {
  endSession,
  enrollMachine,
  type MachineFacts,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { findHive, noHiveMessage, notInHive } from "@/lib/no-hive"
import { apiSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { getGitHubApp } from "@/lib/github"

/**
 * Enrolls the caller's machine and returns its token, once.
 *
 * Called by the daemon right after device sign-in. A machine can serve
 * several of its owner's organizations; each one asked for is authorized
 * separately, and named by id or as GitHub names the organization. The
 * sign-in session is ended here: from now on the machine token is the
 * daemon's only credential, so a person's session expiring never takes their
 * machine offline.
 *
 * An enroll key (`Bearer hwe_…`) stands in for the sign-in: the machine is
 * the key's minter's, in the key's hive, and nobody approves anything.
 */
export async function POST(request: Request) {
  try {
    const key = request.headers
      .get("authorization")
      ?.match(/^Bearer (hwe_\S+)$/)?.[1]
    if (key) return await enrollByKey(request, key)
    const { user, session, bearer } = await apiSession(request)
    const input = (await request.json()) as Record<string, unknown>
    const db = getDb()
    const pools = await listOrganizations(db, user.id)

    // Signed in fine, but in no hive: the usual first-run dead end. The
    // message is complete on its own because every daemon prints it.
    if (!pools.length)
      return Response.json(
        {
          error: noHiveMessage(),
          code: "NO_HIVE",
          pools: [],
        },
        { status: 403 }
      )
    const asked = input.organizationIds
    if (asked === undefined && pools.length !== 1)
      // The daemon shows this list and asks again with a choice.
      return Response.json(
        {
          error: "Choose which hives this machine should serve",
          code: "CHOOSE_POOL",
          pools: pools.map(({ id, name }) => ({ id, name })),
        },
        { status: 409 }
      )
    const hives = asked === undefined ? [pools[0]!.id] : asked
    if (
      !Array.isArray(hives) ||
      !hives.every((hive): hive is string => typeof hive === "string")
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    // Every hive asked for must be one of theirs, or nothing is enrolled: a
    // misspelt name is better refused than half done.
    const unknown = hives.find((hive) => !findHive(pools, hive))
    if (unknown !== undefined)
      throw new AppError("NOT_FOUND", notInHive(unknown, pools))
    const organizationIds = hives.map((hive) => findHive(pools, hive)!.id)

    const result = await enrollMachine(db, getGitHubApp(), {
      userId: user.id,
      organizationIds,
      facts: input as unknown as MachineFacts,
    })
    if (!result.ok)
      throw new AppError(result.code, result.message, result.fields)
    if (bearer) await endSession(db, session.id)
    const named = (id: string) => ({
      id,
      name: pools.find((pool) => pool.id === id)?.name ?? id,
    })
    return Response.json(
      {
        machineId: result.machineId,
        token: result.token,
        pools: result.joined.map(named),
        refused: result.refused.map((refusal) => ({
          ...named(refusal.organizationId),
          message: refusal.message,
        })),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "machine.enroll")
    return errorResponse(error, requestId())
  }
}

async function enrollByKey(request: Request, key: string) {
  const input = (await request.json()) as Record<string, unknown>
  const hives = input.organizationIds
  if (
    hives !== undefined &&
    !(
      Array.isArray(hives) &&
      hives.every((hive): hive is string => typeof hive === "string")
    )
  )
    throw new AppError("INVALID_INPUT", "Invalid input")
  const result = await enrollWithKey(getDb(), getGitHubApp(), {
    key,
    hives,
    facts: input as unknown as MachineFacts,
  })
  if (!result.ok) throw new AppError(result.code, result.message, result.fields)
  return Response.json(
    {
      machineId: result.machineId,
      token: result.token,
      pools: [result.hive],
      refused: [],
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  )
}
