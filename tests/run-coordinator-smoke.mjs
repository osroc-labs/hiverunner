// Starts the coordinator Worker on a fresh local D1 and drives it as a
// daemon would. Nothing here reaches the network.
import { spawn, spawnSync } from "node:child_process"
import {
  mkdtempSync,
  openSync,
  closeSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { once } from "node:events"
import { request as httpRequest } from "node:http"
import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"

const storage = mkdtempSync("/tmp/hiveworker-coordinator.")
const reservation = createServer()
reservation.listen(0, "127.0.0.1")
await once(reservation, "listening")
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const origin = `http://localhost:${port}`
const log = openSync(`${storage}/worker.log`, "w")

function wrangler(app, args, options = {}) {
  return spawnSync("pnpm", ["--filter", app, "exec", "wrangler", ...args], {
    stdio: ["ignore", log, log],
    ...options,
  })
}
/** Runs SQL against the same local D1 the Worker is using. */
function sql(command) {
  const result = wrangler(
    "web",
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      storage,
      "--json",
      "--command",
      command,
    ],
    { stdio: ["ignore", "pipe", log], encoding: "utf8" }
  )
  if (result.status !== 0) throw new Error(`SQL failed: ${command}`)
  return JSON.parse(result.stdout)[0].results
}
const hash = (token) => createHash("sha256").update(token).digest("hex")
const tokens = { a: "hwm_machine-a", b: "hwm_machine-b" }

let worker
let passed = false
try {
  if (
    wrangler("web", [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      storage,
    ]).status !== 0
  )
    throw new Error("Local migrations failed")
  const seed = `${storage}/seed.sql`
  writeFileSync(
    seed,
    [
      "INSERT INTO organization (id,name,slug,created_at) VALUES ('gh-501','acme','gh-501',0);",
      "INSERT INTO github_installation (account_id,installation_id,organization_id,account_login,account_type,repository_selection,status,created_at,updated_at) VALUES (501,9001,'gh-501','acme','Organization','all','active',0,0);",
      "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('ada','Ada','ada@example.test',1,0,0);",
      ...Object.entries(tokens).map(
        ([id, token], i) =>
          `INSERT INTO machine (id,organization_id,user_id,name,model,os,arch,cores,memory_bytes,speed_score,daemon_version,token_hash,created_at) VALUES ('${id}','gh-501','ada','Mac ${id}','Mac15,9','darwin','arm64',12,1,${1 + i},'0.0.0','${hash(token)}',0);`
      ),
    ].join("\n")
  )
  if (
    wrangler("web", [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      storage,
      "--file",
      seed,
    ]).status !== 0
  )
    throw new Error("Seeding failed")

  worker = spawn(
    "pnpm",
    [
      "--filter",
      "coordinator",
      "exec",
      "wrangler",
      "dev",
      "--port",
      String(port),
      "--var",
      "SWEEP_SECONDS:1",
      "--local-upstream",
      `localhost:${port}`,
      "--persist-to",
      storage,
    ],
    { stdio: ["ignore", log, log], detached: true }
  )
  let ready = false
  for (let attempt = 0; attempt < 150; attempt++) {
    if (worker.exitCode !== null)
      throw new Error("Worker exited before startup")
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        ready = true
        break
      }
    } catch {
      /* Starting. */
    }
    await delay(100)
  }
  if (!ready) throw new Error("Coordinator did not become healthy")

  /** A daemon's end of the tunnel, with its frames queued for the test. */
  async function connect(token) {
    const socket = new WebSocket(`ws://localhost:${port}/v1/tunnel`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const frames = []
    const waiting = []
    let closed
    socket.addEventListener("message", (event) => {
      const next = waiting.shift()
      if (next) next(event.data)
      else frames.push(event.data)
    })
    socket.addEventListener("close", (event) => (closed = event.code))
    await once(socket, "open")
    return {
      send: (message) =>
        socket.send(
          typeof message === "string" ? message : JSON.stringify(message)
        ),
      next: async () => {
        const raw =
          frames.shift() ??
          (await Promise.race([
            new Promise((resolve) => waiting.push(resolve)),
            delay(5000).then(() => {
              throw new Error("No frame within 5s")
            }),
          ]))
        return raw === "pong" ? raw : JSON.parse(raw)
      },
      closedWith: async () => {
        for (let i = 0; i < 100 && closed === undefined; i++) await delay(50)
        return closed
      },
      close: () => socket.close(),
    }
  }
  const presence = (id) =>
    sql(`select presence from machine where id='${id}'`)[0].presence
  async function eventually(check, message) {
    for (let i = 0; i < 60; i++) {
      if (await check()) return
      await delay(100)
    }
    throw new Error(message)
  }
  const hello = (state = "online") => ({
    type: "hello",
    protocol: 1,
    daemonVersion: "0.1.0",
    presence: state,
  })

  /** The HTTP status a tunnel request gets, without completing an upgrade. */
  const tunnelStatus = (headers) =>
    new Promise((resolve, reject) => {
      const request = httpRequest({
        port,
        host: "localhost",
        path: "/v1/tunnel",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": Buffer.from(crypto.randomUUID()).toString(
            "base64"
          ),
          ...headers,
        },
      })
      request.on("response", (response) => resolve(response.statusCode))
      request.on("upgrade", (response, socket) => {
        socket.destroy()
        resolve(response.statusCode)
      })
      request.on("error", reject)
      request.end()
    })

  // Only an enrolled machine gets a tunnel.
  assert.equal((await fetch(`${origin}/v1/tunnel`)).status, 426)
  assert.equal(await tunnelStatus({}), 401)
  assert.equal(await tunnelStatus({ Authorization: "Bearer hwm_nope" }), 401)

  const a = await connect(tokens.a)
  assert.deepEqual(await a.next(), {
    type: "welcome",
    machineId: "a",
    protocol: 1,
  })
  // Nothing is believed before hello, and junk does not kill the tunnel.
  a.send({ type: "presence", presence: "online" })
  assert.equal((await a.next()).type, "error")
  a.send("not json")
  assert.equal((await a.next()).type, "error")
  assert.equal(presence("a"), "offline")
  a.send(hello())
  await eventually(() => presence("a") === "online", "hello sets presence")
  assert.equal(
    sql("select daemon_version v from machine where id='a'")[0].v,
    "0.1.0"
  )
  a.send({ type: "presence", presence: "paused" })
  await eventually(
    () => presence("a") === "paused",
    "presence is written through"
  )
  a.send("ping")
  assert.equal(await a.next(), "pong")
  console.log("Tunnel authentication, hello and presence passed.")

  // A reconnect replaces the old socket without flapping to offline.
  const a2 = await connect(tokens.a)
  assert.equal((await a2.next()).type, "welcome")
  assert.equal(await a.closedWith(), 4000)
  a2.send(hello())
  await eventually(
    () => presence("a") === "online",
    "the new socket is the machine"
  )
  await delay(300)
  assert.equal(
    presence("a"),
    "online",
    "the old socket closing changed nothing"
  )

  // An old daemon is told to update rather than half-working.
  const b = await connect(tokens.b)
  await b.next()
  b.send({ ...hello(), protocol: 0 })
  assert.equal(await b.closedWith(), 4002)

  // Revocation is a row in D1; the pool notices on its own.
  const b2 = await connect(tokens.b)
  await b2.next()
  b2.send(hello())
  await eventually(() => presence("b") === "online", "b is online")
  sql("update machine set status='revoked' where id='b'")
  assert.equal(await b2.closedWith(), 4001)
  await eventually(
    () => presence("b") === "offline",
    "revoked machines go offline"
  )
  assert.equal(presence("a"), "online")
  assert.equal(await tunnelStatus({ Authorization: `Bearer ${tokens.b}` }), 401)
  console.log("Reconnect, version refusal and revocation passed.")

  // Uninstalling the App silences the whole pool.
  sql("update github_installation set status='removed'")
  assert.equal(await a2.closedWith(), 4001)
  await eventually(() => presence("a") === "offline", "the pool empties")
  console.log("Installation removal passed.")
  passed = true
} finally {
  if (worker?.pid) {
    try {
      process.kill(-worker.pid, "SIGTERM")
    } catch {
      /* Already exited. */
    }
    if (worker.exitCode === null) await once(worker, "exit")
  }
  closeSync(log)
  if (passed) rmSync(storage, { recursive: true, force: true })
  else console.error(`Local diagnostics retained at ${storage}`)
}
