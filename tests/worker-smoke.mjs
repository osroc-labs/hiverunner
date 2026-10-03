// Run by tests/run-worker-smoke.mjs against the built Worker, a fresh local
// D1 and a fake GitHub. Nothing here reaches the network.
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
const [origin, storage] = process.argv.slice(2)
const {
  SMOKE_GITHUB_URL: githubUrl,
  SMOKE_WEBHOOK_SECRET: webhookSecret,
  SMOKE_PASSWORD: password,
} = process.env
assert.equal(new URL(origin).hostname, "localhost")
assert.ok(storage?.startsWith("/tmp/hiveworker-smoke."))

function browser() {
  const cookies = new Map()
  return async (path, body, extra = {}) => {
    const response = await fetch(new URL(path, origin), {
      method: body ? "POST" : "GET",
      redirect: "manual",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0],
        i = first.indexOf("=")
      cookies.set(first.slice(0, i), first.slice(i + 1))
    }
    return response
  }
}
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text())
  return response.json()
}
async function redirectsTo(response, location, status = 302) {
  assert.equal(response.status, status, await response.clone().text())
  assert.equal(response.headers.get("location"), location)
}
async function page(request, path) {
  const response = await request(path)
  assert.equal(response.status, 200, path)
  return response.text()
}
async function signIn(id) {
  const request = browser()
  await json(
    await request("/api/auth/sign-in/email", {
      email: `${id}@example.test`,
      password,
    })
  )
  return request
}

// What GitHub knows. Replaced wholesale whenever the story changes.
const github = {
  users: {
    "token-owner": { id: 101, login: "owner" },
    "token-member": { id: 102, login: "member" },
    "token-outsider": { id: 103, login: "outsider" },
  },
  visible: {
    "token-owner": [9001, 9100],
    "token-member": [9001],
    "token-outsider": [],
  },
  installations: {
    9001: { account: { id: 501, login: "acme", type: "Organization" } },
    9100: { account: { id: 101, login: "owner", type: "User" } },
  },
  roles: { "acme/owner": "admin", "acme/member": "member" },
}
async function tellGitHub(change = {}) {
  Object.assign(github, change)
  const response = await fetch(`${githubUrl}/__state`, {
    method: "PUT",
    body: JSON.stringify(github),
  })
  assert.equal(response.status, 200)
}
let delivery = 0
function webhook(event, payload, { secret = webhookSecret, id } = {}) {
  const body = JSON.stringify(payload)
  return fetch(`${origin}/api/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": id ?? `delivery-${++delivery}`,
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
  })
}
const installed = (action, extra = {}) => ({
  action,
  installation: {
    id: 9001,
    account: { id: 501, login: "acme", type: "Organization" },
    repository_selection: "all",
    ...extra,
  },
})
await tellGitHub()

// The public surface answers without a session.
assert.equal((await json(await fetch(`${origin}/api/health`))).ok, true)
assert.equal((await fetch(origin)).status, 200)
await redirectsTo(
  await fetch(`${origin}/install`, { redirect: "manual" }),
  "https://github.com/apps/hiveworker-smoke/installations/new"
)
for (const path of ["/billing", "/projects", "/mcp", "/connections"])
  assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
console.log("Public pages, install link and disabled features passed.")

// Webhooks: only GitHub's signature gets in, and a redelivery changes nothing.
assert.equal(
  (await webhook("installation", installed("created"), { secret: "wrong" }))
    .status,
  401
)
assert.equal(
  (await json(await webhook("installation", installed("created"), { id: "a" })))
    .outcome,
  "provisioned"
)
assert.equal(
  (await json(await webhook("installation", installed("created"), { id: "a" })))
    .outcome,
  "duplicate"
)
console.log("Signed webhook provisioning and delivery dedupe passed.")

// Returning from GitHub: the installation id in the URL proves nothing.
const anonymous = browser()
await redirectsTo(
  await anonymous("/github/setup?installation_id=9001&setup_action=install"),
  `/sign-in?next=${encodeURIComponent("/github/setup?installation_id=9001&setup_action=install")}`
)
const owner = await signIn("owner")
assert.ok((await page(owner, "/dashboard")).includes("No pool yet"))
await redirectsTo(
  await owner("/github/setup?installation_id=7777"),
  "/github/status?state=denied"
)
await redirectsTo(
  await owner("/github/setup?installation_id=abc"),
  "/github/status?state=invalid"
)
await redirectsTo(
  await owner("/github/setup?installation_id=9001&setup_action=request"),
  "/github/status?state=requested"
)
await redirectsTo(
  await owner("/github/setup?installation_id=9100"),
  "/github/status?state=personal"
)
const outsider = await signIn("outsider")
await redirectsTo(
  await outsider("/github/setup?installation_id=9001"),
  "/github/status?state=denied"
)
// Able to see the installation, but not a member of the organization.
await tellGitHub({ visible: { ...github.visible, "token-outsider": [9001] } })
await redirectsTo(
  await outsider("/github/setup?installation_id=9001"),
  "/github/status?state=not-member"
)
const local = await signIn("local")
await redirectsTo(
  await local("/github/setup?installation_id=9001"),
  "/github/status?state=github-required"
)
await redirectsTo(
  await owner("/github/setup?installation_id=9001&setup_action=install"),
  "/dashboard?installed=1"
)
let dashboard = await page(owner, "/dashboard?installed=1")
assert.ok(dashboard.includes("acme"))
assert.ok(dashboard.includes("runs-on: hive"))
// The page text also appears in its RSC payload, so count relative to now.
const grants = (html) => html.split("Trial grant").length - 1
const grantsAtInstall = grants(await page(owner, "/wallet"))
assert.ok(grantsAtInstall > 0)
assert.ok((await page(outsider, "/dashboard")).includes("No pool yet"))
await redirectsTo(await outsider("/wallet"), "/dashboard", 307)
console.log(
  "Installation claim check, personal accounts and non-members passed."
)

// Members arrive by signing in; nobody is invited.
const member = await signIn("member")
await redirectsTo(await member("/github/sync"), "/dashboard")
assert.ok((await page(member, "/dashboard")).includes("acme"))
assert.ok((await page(member, "/pools")).includes("acme"))
await redirectsTo(
  await member("/github/sync?next=https://evil.example"),
  "/dashboard"
)
const organizationId = "gh-501"
const settings = (request, change = {}) =>
  request("/api/pool/settings", {
    organizationId,
    allowedTeams: ["ci"],
    earningsDestination: "developer",
    version: 1,
    ...change,
  })
assert.equal((await settings(member)).status, 403)
assert.equal((await settings(outsider)).status, 403)
assert.equal(
  (await settings(owner, { allowedTeams: ["Not a slug"] })).status,
  400
)
await json(await settings(owner))
assert.equal((await settings(owner)).status, 409, "a stale version is refused")
assert.ok((await page(owner, "/settings")).includes('value="ci"'))
assert.equal(
  (
    await fetch(`${origin}/api/pool/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: "{}",
    })
  ).status,
  403
)
// Better Auth's own organization endpoints would bypass GitHub.
for (const [path, body] of [
  ["create", { name: "Rogue", slug: "rogue" }],
  ["invite-member", { organizationId, email: "x@example.test", role: "owner" }],
  ["update-member-role", { organizationId, memberId: "x", role: "owner" }],
  ["remove-member", { organizationId, memberIdOrEmail: "owner@example.test" }],
  ["delete", { organizationId }],
])
  assert.equal(
    (await member(`/api/auth/organization/${path}`, body)).status,
    404,
    path
  )
console.log("Member sign-in, owner-only settings and locked endpoints passed.")

// GitHub being down is not the same as GitHub saying no.
await tellGitHub({ down: true })
await redirectsTo(await member("/github/sync"), "/dashboard")
assert.ok((await page(member, "/dashboard")).includes("acme"))
await tellGitHub({ down: false })

// Leaving the organization on GitHub ends access here.
assert.equal(
  (
    await json(
      await webhook("organization", {
        action: "member_removed",
        organization: { id: 501, login: "acme" },
        membership: { user: { id: 102 } },
      })
    )
  ).outcome,
  "member-removed"
)
assert.ok((await page(member, "/dashboard")).includes("No pool yet"))
assert.equal((await settings(member, { version: 2 })).status, 403)
// And a sync agrees with the webhook once GitHub's own answer changes.
await tellGitHub({ roles: { "acme/owner": "admin" } })
await redirectsTo(await member("/github/sync"), "/dashboard")
assert.ok((await page(member, "/dashboard")).includes("No pool yet"))
console.log("GitHub outage tolerance and member removal passed.")

// The installation's own lifecycle.
await json(await webhook("installation", installed("suspend")))
assert.ok((await page(owner, "/dashboard")).includes("suspended"))
await json(await webhook("installation", installed("unsuspend")))
assert.ok(!(await page(owner, "/dashboard")).includes("suspended"))
await json(await webhook("installation", installed("deleted")))
dashboard = await page(owner, "/dashboard")
assert.ok(dashboard.includes("uninstalled"))
// Reinstalling gets a new installation id and the same pool and balance.
await tellGitHub({
  installations: {
    ...github.installations,
    9002: { account: { id: 501, login: "acme", type: "Organization" } },
  },
  visible: { ...github.visible, "token-owner": [9002] },
})
await json(await webhook("installation", installed("created", { id: 9002 })))
await redirectsTo(
  await owner("/github/setup?installation_id=9002"),
  "/dashboard?installed=1"
)
assert.equal(
  grants(await page(owner, "/wallet")),
  grantsAtInstall,
  "one grant, ever"
)
assert.equal(
  (
    await json(
      await webhook(
        "installation",
        installed("created", {
          id: 9100,
          account: { id: 101, login: "owner", type: "User" },
        })
      )
    )
  ).outcome,
  "unsupported"
)
console.log("Suspend, uninstall, reinstall and the single grant passed.")

// Sessions.
const another = await signIn("owner")
const current = await json(await another("/api/auth/get-session"))
await json(await owner("/api/account/sessions", { id: current.session.id }))
assert.equal(await json(await another("/api/auth/get-session")), null)
for (const path of ["/account", "/settings", "/wallet"])
  assert.equal((await owner(path)).status, 200, path)
await redirectsTo(await anonymous("/dashboard"), "/sign-in", 307)
console.log("Session revocation and account screens passed.")
