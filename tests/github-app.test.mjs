import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { compare, settingsUrl } from "../scripts/github-app.mjs"

const manifest = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../apps/web/github-app.json"),
    "utf8"
  )
)
// The App as GET /app describes one made from the manifest.
const app = {
  id: 1,
  slug: "hiveworker-ci",
  name: manifest.name,
  description: manifest.description,
  external_url: manifest.url,
  owner: { login: "thecomputerplumbers", type: "Organization" },
  permissions: manifest.default_permissions,
  events: manifest.default_events,
}
const hook = { url: manifest.hook_attributes.url, content_type: "json" }

test("an App made from the manifest matches it", () => {
  assert.deepEqual(compare(manifest, app, hook), [])
  assert.equal(
    settingsUrl(app),
    "https://github.com/organizations/thecomputerplumbers/settings/apps/hiveworker-ci"
  )
  assert.equal(
    settingsUrl({ ...app, owner: { login: "ada", type: "User" } }),
    "https://github.com/settings/apps/hiveworker-ci"
  )
})

test("what differs is said, each as something to change", () => {
  const problems = compare(
    manifest,
    {
      ...app,
      external_url: "https://hiveworker.example",
      permissions: { ...app.permissions, members: "write", contents: "read" },
      events: app.events.filter((event) => event !== "team"),
    },
    { url: "https://old.example/api/github/webhook" }
  )
  for (const want of [
    /^Homepage URL /,
    /^Webhook URL .*old\.example/,
    /^Permission members is "write"; the manifest says "read"/,
    /^Permission contents .* does not ask for it/,
    /^Event team is not subscribed/,
  ])
    assert.ok(
      problems.some((problem) => want.test(problem)),
      `${want} in ${problems.join("\n")}`
    )
})

test("another environment's App is compared at its own origin", () => {
  const staging = "https://staging.hiverunner.dev"
  const at = (url) => url.replace("https://hiverunner.dev", staging)
  assert.deepEqual(
    compare(
      manifest,
      { ...app, external_url: at(manifest.url) },
      { url: at(manifest.hook_attributes.url) },
      staging
    ),
    []
  )
})
