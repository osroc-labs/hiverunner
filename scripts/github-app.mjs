// `pnpm run github-app check`: whether the GitHub App on GitHub matches
// apps/web/github-app.json, and what to change by hand where it does not.
// GitHub has no API to edit an existing App's settings, so this only reads:
// GET /app and GET /app/hook/config, as the App, with a JWT made from
// GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (the PEM, or a path to it in
// GITHUB_APP_PRIVATE_KEY_FILE). Neither is printed.
//
//   pnpm run github-app check [--origin https://staging.example]
//
// --origin stands in for the manifest's origin, for an environment's own App.
import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { root } from "./project-lib.mjs"

const PRODUCTION = "https://hiverunner.dev"

/** What differs between the manifest and the App, as sentences to act on. */
export function compare(manifest, app, hook, origin = PRODUCTION) {
  const at = (url) => url.replace(PRODUCTION, origin)
  const problems = []
  const differs = (what, want, have) => {
    if (JSON.stringify(want) !== JSON.stringify(have))
      problems.push(
        `${what} is ${JSON.stringify(have)}; the manifest says ${JSON.stringify(want)}`
      )
  }
  differs("Name", manifest.name, app.name)
  differs("Description", manifest.description, app.description)
  differs("Homepage URL", at(manifest.url), app.external_url)
  differs("Webhook URL", at(manifest.hook_attributes.url), hook.url)
  for (const [name, access] of Object.entries(manifest.default_permissions))
    differs(`Permission ${name}`, access, app.permissions?.[name] ?? null)
  for (const [name, access] of Object.entries(app.permissions ?? {}))
    if (!(name in manifest.default_permissions))
      problems.push(
        `Permission ${name} is ${JSON.stringify(access)}; the manifest does not ask for it`
      )
  const events = new Set(app.events ?? [])
  for (const event of manifest.default_events)
    if (!events.has(event)) problems.push(`Event ${event} is not subscribed`)
  for (const event of events)
    if (!manifest.default_events.includes(event))
      problems.push(
        `Event ${event} is subscribed; the manifest does not ask for it`
      )
  return problems
}

/** Where the App's settings are edited, which is the only way to edit them. */
export function settingsUrl(app) {
  return app.owner?.type === "Organization"
    ? `https://github.com/organizations/${app.owner.login}/settings/apps/${app.slug}`
    : `https://github.com/settings/apps/${app.slug}`
}

function jwt(appId, privateKey) {
  const part = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  // A minute back for clock drift; GitHub refuses more than ten ahead.
  const body = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: String(appId) })}`
  const signature = createSign("RSA-SHA256")
    .update(body)
    .sign(privateKey, "base64url")
  return `${body}.${signature}`
}

async function ask(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "hiverunner-github-app-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status} to GET ${path}`)
  return response.json()
}

async function check(args) {
  const flag = args.indexOf("--origin")
  const origin = flag === -1 ? PRODUCTION : args[flag + 1]
  const appId = process.env.GITHUB_APP_ID
  const privateKey =
    process.env.GITHUB_APP_PRIVATE_KEY ||
    (process.env.GITHUB_APP_PRIVATE_KEY_FILE &&
      readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_FILE, "utf8"))
  if (!appId || !privateKey || !origin) {
    console.error(
      "Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (or GITHUB_APP_PRIVATE_KEY_FILE), and pass --origin with a URL if you pass it."
    )
    process.exit(2)
  }
  const manifest = JSON.parse(
    readFileSync(resolve(root, "apps/web/github-app.json"), "utf8")
  )
  const token = jwt(appId, privateKey)
  const app = await ask("/app", token)
  const hook = await ask("/app/hook/config", token)
  const problems = compare(manifest, app, hook, origin)
  const at = (url) => url.replace(PRODUCTION, origin)
  console.log(`${app.name} (${app.slug}), app ${app.id}`)
  for (const problem of problems) console.log(`  DIFFERS  ${problem}`)
  // Not in what the API returns: these are checked by eye.
  console.log("  CHECK BY HAND, the API does not show them:")
  for (const url of manifest.callback_urls)
    console.log(`    Callback URL      ${at(url)}`)
  console.log(`    Setup URL         ${at(manifest.setup_url)}`)
  console.log(
    `    Redirect on update ${manifest.setup_on_update ? "on" : "off"}; request OAuth during installation ${manifest.request_oauth_on_install ? "on" : "off"}; public ${manifest.public ? "yes" : "no"}`
  )
  console.log(`Edit it at ${settingsUrl(app)}`)
  if (problems.length) process.exit(1)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [command, ...args] = process.argv.slice(2)
  if (command !== "check") {
    console.error("Usage: pnpm run github-app check [--origin <url>]")
    process.exit(2)
  }
  await check(args).catch((error) => {
    // A 401 is almost always the wrong key for this App id, or a clock off.
    console.error(error.message)
    process.exit(1)
  })
}
