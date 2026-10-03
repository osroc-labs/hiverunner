import { spawn, spawnSync } from "node:child_process"
import {
  mkdtempSync,
  openSync,
  closeSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { generateKeyPairSync } from "node:crypto"
import { hashPassword } from "../packages/auth/node_modules/better-auth/dist/crypto/index.mjs"
import { startFakeGitHub } from "./fake-github.mjs"
import { createServer } from "node:net"
import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"

// No remote binding or real mail: each run has a fresh, disposable local D1.
const storage = mkdtempSync("/tmp/hiveworker-smoke.")
const reservation = createServer()
reservation.listen(0, "127.0.0.1")
await once(reservation, "listening")
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const origin = `http://localhost:${port}`
const log = openSync(`${storage}/worker.log`, "w")
// A throwaway GitHub App: the Worker signs with the private key and the fake
// GitHub verifies with the public one.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
const github = await startFakeGitHub(publicKey)
const webhookSecret = crypto.randomUUID()
const password = crypto.randomUUID()
// People who have signed in with GitHub before. `local` never has.
const people = [
  { id: "owner", github: 101 },
  { id: "member", github: 102 },
  { id: "outsider", github: 103 },
  { id: "local" },
]
let worker
let passed = false
try {
  const migration = spawnSync(
    "pnpm",
    [
      "--filter",
      "web",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      storage,
    ],
    { stdio: ["ignore", log, log] }
  )
  if (migration.status !== 0) throw new Error("Local migrations failed")
  const hash = await hashPassword(password)
  const seed = `${storage}/seed.sql`
  writeFileSync(
    seed,
    people
      .flatMap((person) => [
        `INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('${person.id}','${person.id}','${person.id}@example.test',1,0,0);`,
        `INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ('pw-${person.id}','${person.id}','credential','${person.id}','${hash}',0,0);`,
        ...(person.github
          ? [
              `INSERT INTO account (id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES ('gh-${person.id}','${person.github}','github','${person.id}','token-${person.id}',0,0);`,
            ]
          : []),
      ])
      .join("\n")
  )
  const seeded = spawnSync(
    "pnpm",
    [
      "--filter",
      "web",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      storage,
      "--file",
      seed,
    ],
    { stdio: ["ignore", log, log] }
  )
  if (seeded.status !== 0) throw new Error("Seeding the smoke users failed")
  worker = spawn(
    "pnpm",
    [
      "--filter",
      "web",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--port",
      String(port),
      "--var",
      `APP_URL:${origin}`,
      "--var",
      "GITHUB_APP_ID:424242",
      "--var",
      "GITHUB_APP_SLUG:hiveworker-smoke",
      "--var",
      // One line: the key parser ignores whitespace, and argv is simpler so.
      `GITHUB_APP_PRIVATE_KEY:${privateKey.export({ type: "pkcs1", format: "pem" }).replaceAll("\n", "")}`,
      "--var",
      `GITHUB_WEBHOOK_SECRET:${webhookSecret}`,
      "--var",
      `GITHUB_API_URL:${github.url}`,
      // Custom-domain routes make wrangler dev present the route host to the
      // Worker; keep the request origin equal to APP_URL.
      "--local-upstream",
      `localhost:${port}`,
      "--persist-to",
      storage,
    ],
    { stdio: ["ignore", log, log], detached: true }
  )
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (worker.exitCode !== null)
      throw new Error("Worker exited before startup")
    try {
      if ((await fetch(`${origin}/api/health`)).ok) {
        ready = true
        break
      }
    } catch {
      /* Starting. */
    }
    await delay(100)
  }
  if (!ready) throw new Error("Local Worker did not become healthy")
  const test = spawn(
    process.execPath,
    ["tests/worker-smoke.mjs", origin, storage],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SMOKE_GITHUB_URL: github.url,
        SMOKE_WEBHOOK_SECRET: webhookSecret,
        SMOKE_PASSWORD: password,
      },
    }
  )
  const [code] = await once(test, "exit")
  if (code !== 0) throw new Error("Worker smoke test failed")
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
  await github.close()
  closeSync(log)
  if (passed) rmSync(storage, { recursive: true, force: true })
  else console.error(`Local diagnostics retained at ${storage}`)
}
