import { env } from "cloudflare:workers"
import { authenticateMachine, listMachinePools } from "@workspace/db/machines"

import { getDb } from "@/db"

/**
 * What a running daemon should be connected to, asked with its machine
 * token. It polls this, which is how it learns it was added to a pool from
 * the dashboard or removed from one, without being reinstalled or restarted.
 */
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)
  const db = getDb()
  const machine = token ? await authenticateMachine(db, token[1]!) : null
  if (!machine)
    return Response.json({ error: "Unknown machine" }, { status: 401 })
  return Response.json(
    {
      machineId: machine.id,
      // Told, not built from a hostname, so moving the coordinator is a
      // configuration change and not a daemon release.
      tunnelUrl: env.COORDINATOR_URL ?? "ws://localhost:8788/v1/tunnel",
      pools: await listMachinePools(db, machine.id),
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
