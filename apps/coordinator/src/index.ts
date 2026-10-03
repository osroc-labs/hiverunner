import { drizzle } from "drizzle-orm/d1"
import { authenticateMachine } from "@workspace/db/machines"

export { Pool } from "./pool"

/**
 * The coordinator's front door. It authenticates a machine token and hands
 * the connection to that organization's pool; everything after that happens
 * inside the pool's Durable Object.
 *
 * A separate Worker from the web app on purpose: deploying a Worker drops
 * the WebSockets its objects hold, and a copy change on the marketing site
 * should not disconnect every machine.
 */
export default {
  async fetch(request: Request, env: CoordinatorEnv) {
    const url = new URL(request.url)
    if (url.pathname === "/health") return Response.json({ ok: true })
    if (url.pathname !== "/v1/tunnel")
      return new Response("Not found", { status: 404 })
    if (request.headers.get("upgrade") !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 })

    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)
    const machine = token
      ? await authenticateMachine(drizzle(env.DB), token[1]!)
      : null
    if (!machine) return new Response("Unauthorized", { status: 401 })

    // The pool trusts these because only this Worker can reach it.
    const headers = new Headers(request.headers)
    headers.delete("authorization")
    headers.set("x-hive-machine", machine.id)
    headers.set("x-hive-cores", String(machine.cores))
    headers.set("x-hive-speed", String(machine.speedScore))
    return env.POOL.getByName(machine.organizationId).fetch(
      new Request(request, { headers })
    )
  },
} satisfies ExportedHandler<CoordinatorEnv>
