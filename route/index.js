// Picks where a job runs. Asks the Hive Runner coordinator whether a machine
// in this organization's hive is free for the label, and answers with that
// label, or with the fallback when none is or the coordinator cannot be
// reached. It never fails the workflow: the worst it does is fall back.
//
// No dependencies: Node's own fetch, and the files the runner names in the
// environment. Who is asking is proved by the job's own OIDC token, which is
// why the job needs `permissions: id-token: write`.
const { appendFileSync } = require("node:fs")

const input = (name, fallback) =>
  (process.env[`INPUT_${name.toUpperCase()}`] || "").trim() || fallback

const label = input("label", "hive")
const fallback = input("fallback", "ubuntu-latest")
const coordinator = input(
  "coordinator",
  "https://connect.hiveworkr.thecomputerplumbers.com"
).replace(/\/+$/, "")
const wait = Math.min(Math.max(Number(input("wait", "15")) || 0, 0), 120)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function identity() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !bearer)
    throw new Error(
      "this job cannot prove who it is: give it `permissions: id-token: write`"
    )
  const response = await fetch(
    `${url}&audience=${encodeURIComponent(coordinator)}`,
    {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!response.ok)
    throw new Error(`GitHub refused a token (${response.status})`)
  const { value } = await response.json()
  if (!value) throw new Error("GitHub returned no token")
  // Kept out of the log, as the runner would for a secret.
  console.log(`::add-mask::${value}`)
  return value
}

/** true: a machine is free. false: none is. A string: why nobody can say. */
async function ask(token) {
  let response
  try {
    response = await fetch(
      `${coordinator}/v1/capacity?label=${encodeURIComponent(label)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      }
    )
  } catch (error) {
    return `the coordinator could not be reached (${error.name})`
  }
  const body = await response.json().catch(() => ({}))
  if (response.ok) return body.available === true
  return `the coordinator said: ${body.error || response.status}`
}

async function route() {
  const token = await identity()
  const deadline = Date.now() + wait * 1000
  let answer
  for (;;) {
    answer = await ask(token)
    if (answer === true) return { runner: label, why: "a machine is free" }
    // An answer that waiting will not change: the label, the installation.
    if (typeof answer === "string" && /said: /.test(answer)) break
    if (Date.now() + 2000 > deadline) break
    await sleep(2000)
  }
  return {
    runner: fallback,
    why: answer === false ? `no machine was free within ${wait}s` : answer,
  }
}

async function main() {
  let chosen
  try {
    chosen = await route()
  } catch (error) {
    chosen = { runner: fallback, why: error.message }
  }
  const routed = chosen.runner === label
  console.log(
    routed
      ? `${label}: ${chosen.why}. Running on your hive.`
      : `${label}: ${chosen.why}. Falling back to ${fallback}.`
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `runner=${chosen.runner}\nrouted=${routed}\n`
    )
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      routed
        ? `**Hive Runner:** running on \`${label}\` (${chosen.why}).\n`
        : `**Hive Runner:** fell back to \`${fallback}\` (${chosen.why}).\n`
    )
}

main()
