import assert from "node:assert/strict"
import { test } from "node:test"
import { createAuth, resolveSecret } from "../packages/auth/src/auth.ts"
import { database } from "./database.mjs"
import { safeReturnPath } from "../packages/stripe/src/portal.ts"
import { createCheckoutSession } from "../packages/stripe/src/checkout.ts"

test("missing deployment configuration never enables the development secret", () => {
  assert.throws(() => resolveSecret(undefined, undefined))
  assert.throws(() => resolveSecret(undefined, "https://app.example"))
  assert.ok(resolveSecret(undefined, "http://localhost:3000"))
})

test("return paths remain on the application origin after URL parsing", () => {
  for (const value of [
    "//evil.example",
    "/a/..//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "https://evil.example",
  ]) {
    assert.equal(
      new URL(safeReturnPath(value, "/billing"), "https://app.example").origin,
      "https://app.example"
    )
  }
  assert.equal(safeReturnPath("/billing?tab=invoices"), "/billing?tab=invoices")
})

test("separate checkout attempts do not share the organization idempotency key", async () => {
  const keys = []
  const client = {
    post: async (_path, _params, options) => {
      keys.push(options.idempotencyKey)
      return { url: "https://checkout.example" }
    },
  }
  for (const price of ["monthly", "yearly", "monthly"]) {
    await createCheckoutSession(client, {
      mode: "subscription",
      lineItems: [{ price }],
      clientReferenceId: "org_1",
      successUrl: "https://app.example/billing",
      cancelUrl: "https://app.example/billing",
    })
  }
  assert.equal(new Set(keys).size, 3)
  assert.ok(keys.every(Boolean))
})

test("passwords are a local convenience and off unless asked for", async (t) => {
  const base = { secret: "x".repeat(32), baseURL: "https://app.example" }
  const deployed = createAuth({
    ...base,
    db: database(t).db,
    github: { clientId: "id", clientSecret: "secret" },
  })
  // Plugins query the database while starting; let them finish first.
  await deployed.$context
  assert.equal(deployed.options.emailAndPassword.enabled, false)
  assert.ok(deployed.options.socialProviders.github)
  const local = createAuth({
    ...base,
    db: database(t).db,
    localPasswordSignIn: true,
  })
  await local.$context
  assert.equal(local.options.emailAndPassword.enabled, true)
})
