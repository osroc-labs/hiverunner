import { listOrganizations } from "@workspace/auth"
import {
  addMachineToPool,
  endSession,
  getMachine,
  listMachinePools,
} from "@workspace/db/machines"

import { getDb } from "@/db"
import { apiSession } from "@/lib/browser-request"
import { logError, requestId } from "@/lib/diagnostics"
import { AppError, errorResponse } from "@/lib/errors"
import { getGitHubApp } from "@/lib/github"

/**
 * Adds a machine its owner already enrolled to more of their hives: what
 * `hived link` asks for, after a device sign-in of its own.
 *
 * The machine token is not enough here. It proves which machine is asking,
 * not that its owner wants another organization's jobs on it, so a person
 * approves each link in a browser as they did the enrollment. That session
 * is ended as this answers, like the one that enrolled the machine.
 *
 * `hives` are names or ids. Without any, the one hive the machine does not
 * serve yet is linked, and someone with several to choose from is shown them.
 */
export async function POST(request: Request) {
  try {
    const { user, session, bearer } = await apiSession(request)
    const input = (await request.json()) as Record<string, unknown>
    const asked = input.hives
    if (
      typeof input.machineId !== "string" ||
      (asked !== undefined &&
        !(
          Array.isArray(asked) &&
          asked.length > 0 &&
          asked.length <= 25 &&
          asked.every((hive) => typeof hive === "string")
        ))
    )
      throw new AppError("INVALID_INPUT", "Invalid input")
    const db = getDb()
    const machine = await getMachine(db, input.machineId)
    // The same answer whether it does not exist or is someone else's.
    if (!machine || machine.userId !== user.id || machine.status !== "active")
      throw new AppError("NOT_FOUND", "No such machine")

    const pools = await listOrganizations(db, user.id)
    const serving = new Set(
      (await listMachinePools(db, machine.id)).map((pool) => pool.id)
    )
    const open = pools.filter((pool) => !serving.has(pool.id))

    const wanted: string[] = []
    const refused: Array<{ id: string; name: string; message: string }> = []
    if (asked === undefined) {
      if (open.length > 1)
        // The daemon shows this list and asks again with a choice.
        return Response.json(
          {
            error: "Choose which hives this machine should serve",
            code: "CHOOSE_POOL",
            pools: pools.map(({ id, name }) => ({
              id,
              name,
              linked: serving.has(id),
            })),
          },
          { status: 409 }
        )
      wanted.push(...open.map((pool) => pool.id))
    } else {
      for (const hive of new Set(asked as string[])) {
        const found = pools.find(
          (pool) =>
            pool.id === hive || pool.name.toLowerCase() === hive.toLowerCase()
        )
        if (!found)
          refused.push({
            id: hive,
            name: hive,
            message: "You are not in a hive with that name.",
          })
        // Already serving it. Adding it again would mark a live tunnel
        // offline, so there is nothing to do and nothing to refuse.
        else if (open.includes(found)) wanted.push(found.id)
      }
    }

    const named = (id: string) => ({
      id,
      name: pools.find((pool) => pool.id === id)?.name ?? id,
    })
    const added: Array<{ id: string; name: string }> = []
    for (const organizationId of new Set(wanted)) {
      const refusal = await addMachineToPool(db, getGitHubApp(), {
        userId: user.id,
        machineId: machine.id,
        organizationId,
      })
      if (refusal)
        refused.push({ ...named(organizationId), message: refusal.message })
      else added.push(named(organizationId))
    }
    if (bearer) await endSession(db, session.id)
    return Response.json(
      {
        machineId: machine.id,
        pools: (await listMachinePools(db, machine.id)).map(({ id, name }) => ({
          id,
          name,
        })),
        added,
        refused,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError(error, "machine.link")
    return errorResponse(error, requestId())
  }
}
