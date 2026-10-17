import assert from "node:assert/strict"
import { test } from "node:test"
import { database } from "./database.mjs"
import {
  applyGitHubEvent,
  organizationIdFor,
  provisionInstallation,
} from "../packages/db/src/installations.ts"
import { getBalance, listEntries } from "../packages/db/src/ledger.ts"
import {
  canAddMachines,
  repairActiveOrganization,
  syncMemberships,
} from "../packages/db/src/membership.ts"
import {
  getPoolSettings,
  routingPolicy,
  updatePoolSettings,
  validatePoolSettings,
} from "../packages/db/src/settings.ts"
import {
  addMachineToPool,
  addMachinesToPool,
  autoJoinMachines,
  joinedHives,
  listUserMachines,
  setMachineAutoJoin,
  JOINED_NOTICE_MS,
  authenticateMachine,
  authenticateMachineForPool,
  enrollMachine,
  listMachinePools,
  listMachines,
  removeMachineFromPool,
  revokeMachine,
  validateMachineFacts,
  MAX_MACHINES_PER_PERSON,
} from "../packages/db/src/machines.ts"
import { GitHubError } from "../packages/github/src/index.ts"

const acme = {
  id: 9001,
  account: { id: 501, login: "acme", type: "Organization" },
  suspended: false,
  repositorySelection: "all",
}
const orgId = organizationIdFor(501)
const organizationAccount = { accountType: "organization", accountId: orgId }

function person(sqlite, id, githubId) {
  sqlite
    .prepare(
      "insert into user (id,name,email,email_verified,created_at,updated_at) values (?,?,?,1,0,0)"
    )
    .run(id, id, `${id}@example.test`)
  sqlite
    .prepare(
      "insert into account (id,account_id,provider_id,user_id,created_at,updated_at) values (?,?,'github',?,0,0)"
    )
    .run(`gh-${id}`, String(githubId), id)
  sqlite
    .prepare(
      "insert into session (id,user_id,token,expires_at,created_at,updated_at) values (?,?,?,0,0,0)"
    )
    .run(`s-${id}`, id, `t-${id}`)
}
const members = (sqlite) =>
  sqlite
    .prepare("select user_id, organization_id, role from member order by 1, 2")
    .all()
    .map((row) => `${row.user_id}:${row.organization_id}:${row.role}`)

/** A GitHub where `roles` says who is what in which organization. */
function github({ viewer, installations = [], roles = {}, teams = {}, down }) {
  return {
    getViewer: async () => viewer,
    getLogin: async () => viewer.login,
    listUserInstallationIds: async () => installations,
    getOrgRole: async (_installation, org, login) => {
      if (down) throw new GitHubError(502, "GitHub responded 502")
      return roles[`${org}/${login}`] ?? null
    },
    isTeamMember: async (_installation, org, team, login) =>
      Boolean(teams[`${org}/${team}`]?.includes(login)),
  }
}

test("an installation provisions one organization, one pool and one grant", async (t) => {
  const { db, sqlite } = database(t)
  for (let i = 0; i < 3; i++)
    assert.deepEqual(await provisionInstallation(db, acme), {
      supported: true,
      organizationId: orgId,
    })
  assert.equal(sqlite.prepare("select count(*) n from organization").get().n, 1)
  assert.equal(await getBalance(db, organizationAccount), 5_000_000)
  assert.equal((await listEntries(db, organizationAccount)).length, 1)
  assert.deepEqual((await getPoolSettings(db, orgId)).allowedTeams, [])
})

test("reinstalling keeps the organization and does not grant again", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  await applyGitHubEvent(db, {
    deliveryId: "d1",
    event: "installation",
    payload: { action: "deleted", installation: { id: 9001 } },
  })
  assert.equal(
    sqlite.prepare("select status from github_installation").get().status,
    "removed"
  )
  await provisionInstallation(db, { ...acme, id: 9002 })
  const row = sqlite.prepare("select * from github_installation").get()
  assert.equal(row.installation_id, 9002)
  assert.equal(row.status, "active")
  assert.equal(await getBalance(db, organizationAccount), 5_000_000)
})

test("personal accounts are refused and create nothing", async (t) => {
  const { db, sqlite } = database(t)
  const result = await provisionInstallation(db, {
    ...acme,
    account: { id: 77, login: "someone", type: "User" },
  })
  assert.equal(result.supported, false)
  assert.equal(sqlite.prepare("select count(*) n from organization").get().n, 0)
  assert.equal(sqlite.prepare("select count(*) n from ledger_entry").get().n, 0)
})

test("webhooks provision, dedupe by delivery, suspend and rename", async (t) => {
  const { db, sqlite } = database(t)
  const created = {
    deliveryId: "delivery-1",
    event: "installation",
    payload: {
      action: "created",
      installation: {
        id: 9001,
        account: { id: 501, login: "acme", type: "Organization" },
        repository_selection: "selected",
      },
    },
  }
  assert.equal(await applyGitHubEvent(db, created), "provisioned")
  assert.equal(await applyGitHubEvent(db, created), "duplicate")
  assert.equal(
    await applyGitHubEvent(db, {
      deliveryId: "delivery-2",
      event: "installation",
      payload: { action: "suspend", installation: { id: 9001 } },
    }),
    "suspended"
  )
  assert.equal(
    await applyGitHubEvent(db, {
      deliveryId: "delivery-3",
      event: "installation_target",
      payload: {
        action: "renamed",
        account: { id: 501, login: "acme-inc", type: "Organization" },
      },
    }),
    "renamed"
  )
  const row = sqlite.prepare("select * from github_installation").get()
  assert.equal(row.status, "suspended")
  assert.equal(row.account_login, "acme-inc")
  assert.equal(
    sqlite.prepare("select name from organization").get().name,
    "acme-inc"
  )
  assert.equal(
    await applyGitHubEvent(db, {
      deliveryId: "delivery-4",
      event: "push",
      payload: {},
    }),
    "ignored"
  )
})

test("membership follows GitHub: added, promoted, removed", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const viewer = { id: 1, login: "ada" }
  const input = { userId: "ada", userToken: "token" }

  let result = await syncMemberships(
    db,
    github({ viewer, installations: [9001], roles: { "acme/ada": "member" } }),
    input
  )
  assert.deepEqual(result.organizationIds, [orgId])
  assert.deepEqual(members(sqlite), [`ada:${orgId}:member`])

  await syncMemberships(
    db,
    github({ viewer, installations: [9001], roles: { "acme/ada": "admin" } }),
    input
  )
  assert.deepEqual(members(sqlite), [`ada:${orgId}:owner`])

  // The installation is no longer visible to her token, but she is still a
  // member according to the organization: visibility is not membership.
  await syncMemberships(
    db,
    github({ viewer, installations: [], roles: { "acme/ada": "admin" } }),
    input
  )
  assert.deepEqual(members(sqlite), [`ada:${orgId}:owner`])

  result = await syncMemberships(
    db,
    github({ viewer, installations: [9001] }),
    input
  )
  assert.deepEqual(result.organizationIds, [])
  assert.deepEqual(members(sqlite), [])
})

test("a GitHub outage leaves cached membership alone", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const viewer = { id: 1, login: "ada" }
  const input = { userId: "ada", userToken: "token" }
  await syncMemberships(
    db,
    github({ viewer, installations: [9001], roles: { "acme/ada": "member" } }),
    input
  )
  await assert.rejects(
    syncMemberships(
      db,
      github({ viewer, installations: [9001], down: true }),
      input
    )
  )
  assert.deepEqual(members(sqlite), [`ada:${orgId}:member`])
})

test("a token for a different GitHub account is refused", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await assert.rejects(
    syncMemberships(
      db,
      github({
        viewer: { id: 2, login: "mallory" },
        installations: [9001],
        roles: { "acme/mallory": "admin" },
      }),
      { userId: "ada", userToken: "token" }
    )
  )
  assert.deepEqual(members(sqlite), [])
})

test("suspended installations confer no membership", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, { ...acme, suspended: true })
  person(sqlite, "ada", 1)
  await syncMemberships(
    db,
    github({
      viewer: { id: 1, login: "ada" },
      installations: [9001],
      roles: { "acme/ada": "admin" },
    }),
    { userId: "ada", userToken: "token" }
  )
  assert.deepEqual(members(sqlite), [])
})

test("member_removed webhooks drop the member at once", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await syncMemberships(
    db,
    github({
      viewer: { id: 1, login: "ada" },
      installations: [9001],
      roles: { "acme/ada": "member" },
    }),
    { userId: "ada", userToken: "token" }
  )
  const event = (id) => ({
    deliveryId: `removed-${id}`,
    event: "organization",
    payload: {
      action: "member_removed",
      organization: { id: 501, login: "acme" },
      membership: { user: { id } },
    },
  })
  assert.equal(await applyGitHubEvent(db, event(404)), "ignored")
  assert.equal(members(sqlite).length, 1)
  assert.equal(await applyGitHubEvent(db, event(1)), "member-removed")
  assert.deepEqual(members(sqlite), [])
})

test("sessions are repointed away from a pool the person left", async (t) => {
  const { db, sqlite } = database(t)
  person(sqlite, "ada", 1)
  const active = () =>
    sqlite.prepare("select active_organization_id a from session").get().a
  await repairActiveOrganization(db, {
    userId: "ada",
    organizationIds: ["a", "b"],
  })
  assert.equal(active(), "a")
  await repairActiveOrganization(db, {
    userId: "ada",
    organizationIds: ["a", "b"],
    prefer: "b",
  })
  assert.equal(active(), "b")
  await repairActiveOrganization(db, {
    userId: "ada",
    organizationIds: ["a", "b"],
  })
  assert.equal(active(), "b")
  await repairActiveOrganization(db, { userId: "ada", organizationIds: ["a"] })
  assert.equal(active(), "a")
  await repairActiveOrganization(db, { userId: "ada", organizationIds: [] })
  assert.equal(active(), null)
})

test("team restriction gates machines for members but not owners", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const input = { organizationId: orgId, userId: "ada" }
  const viewer = { id: 1, login: "ada" }
  const asMember = { viewer, roles: { "acme/ada": "member" } }

  assert.equal(await canAddMachines(db, github(asMember), input), true)
  assert.equal(
    await updatePoolSettings(db, orgId, {
      allowedTeams: ["ci"],
      earningsDestination: "developer",
      macosJobs: false,
      routing: "fastest",
      version: 1,
    }),
    true
  )
  assert.equal(await canAddMachines(db, github(asMember), input), false)
  assert.equal(
    await canAddMachines(
      db,
      github({ ...asMember, teams: { "acme/ci": ["ada"] } }),
      input
    ),
    true
  )
  assert.equal(
    await canAddMachines(
      db,
      github({ viewer, roles: { "acme/ada": "admin" } }),
      input
    ),
    true
  )
  assert.equal(await canAddMachines(db, github({ viewer }), input), false)
})

test("pool settings refuse stale versions and bad slugs", async (t) => {
  const { db } = database(t)
  await provisionInstallation(db, acme)
  const change = {
    allowedTeams: ["ci"],
    earningsDestination: "developer",
    macosJobs: true,
    routing: "round-robin",
    version: 1,
  }
  assert.equal(await updatePoolSettings(db, orgId, change), true)
  assert.equal(await updatePoolSettings(db, orgId, change), false)
  assert.equal((await getPoolSettings(db, orgId)).version, 2)
  assert.equal((await getPoolSettings(db, orgId)).macosJobs, true)
  assert.equal((await getPoolSettings(db, orgId)).routing, "round-robin")
  assert.equal(await routingPolicy(db, orgId), "round-robin")
  assert.equal(await routingPolicy(db, "no-such-hive"), "fastest")
  assert.ok(validatePoolSettings({ ...change, routing: "random" }).routing)
  assert.equal(validatePoolSettings(change), null)
  assert.ok(validatePoolSettings({ ...change, macosJobs: "yes" }).macosJobs)
  assert.ok(
    validatePoolSettings({ ...change, allowedTeams: ["Not A Slug"] })
      .allowedTeams
  )
  assert.ok(
    validatePoolSettings({ ...change, allowedTeams: ["ci", "ci"] }).allowedTeams
  )
  assert.ok(
    validatePoolSettings({ ...change, earningsDestination: "me" })
      .earningsDestination
  )
})

const mac = {
  name: "Ada's MacBook Pro",
  model: "Mac15,9",
  os: "darwin",
  arch: "arm64",
  cores: 12,
  memoryBytes: 36 * 2 ** 30,
  daemonVersion: "0.1.0",
}
const globex = {
  id: 9002,
  account: { id: 502, login: "globex", type: "Organization" },
  suspended: false,
  repositorySelection: "all",
}
const globexId = organizationIdFor(502)
const viewer = { id: 1, login: "ada" }
const sync = { userId: "ada", userToken: "token" }
const inAcme = () =>
  github({ viewer, installations: [9001], roles: { "acme/ada": "member" } })
const inBoth = () =>
  github({
    viewer,
    installations: [9001, 9002],
    roles: { "acme/ada": "member", "globex/ada": "member" },
  })

test("machines enroll once, authenticate by token, and stop when revoked", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const input = {
    userId: "ada",
    organizationIds: [orgId],
    facts: { ...mac, speedScore: 99 },
  }

  // Not a member yet: nothing to enroll into.
  const outside = await enrollMachine(db, inAcme(), input)
  assert.equal(outside.code, "NOT_FOUND")
  assert.match(outside.message, /not a member of this hive/)
  assert.equal(sqlite.prepare("select count(*) n from machine").get().n, 0)
  await syncMemberships(db, inAcme(), sync)

  const bad = await enrollMachine(db, inAcme(), {
    ...input,
    facts: { ...mac, os: "windows", arch: "x64", cores: 0 },
  })
  assert.equal(bad.code, "INVALID_INPUT")
  assert.ok(bad.fields.os && bad.fields.cores)
  const enrolled = await enrollMachine(db, inAcme(), input)
  assert.equal(enrolled.ok, true)
  assert.deepEqual(enrolled.joined, [orgId])
  const row = sqlite.prepare("select * from machine").get()
  assert.equal(row.speed_score, 8, "a claimed score is clamped")
  assert.ok(
    !JSON.stringify(row).includes(enrolled.token),
    "only the hash is stored"
  )

  const forAcme = (token = enrolled.token) =>
    authenticateMachineForPool(db, token, orgId)
  assert.equal((await forAcme()).id, enrolled.machineId)
  assert.equal(await forAcme(`${enrolled.token}x`), null)
  assert.equal(await forAcme("not-a-machine-token"), null)
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, "gh-999"),
    null
  )

  // A suspended installation silences its pool without revoking anything.
  await provisionInstallation(db, { ...acme, suspended: true })
  assert.equal(await forAcme(), null)
  assert.ok(await authenticateMachine(db, enrolled.token))
  await provisionInstallation(db, acme)
  assert.ok(await forAcme())

  await revokeMachine(db, enrolled.machineId)
  assert.equal(await forAcme(), null)
  assert.equal(await authenticateMachine(db, enrolled.token), null)
})

test("a machine enrolls as what it is, in the product's words", async (t) => {
  // The daemon reports Go's names, and exactly three are hosts.
  for (const [os, arch] of [
    ["darwin", "arm64"],
    ["linux", "arm64"],
    ["linux", "amd64"],
  ])
    assert.equal(
      validateMachineFacts({ ...mac, os, arch }),
      null,
      `${os} ${arch}`
    )
  for (const [os, arch] of [
    ["darwin", "amd64"],
    ["darwin", "x64"],
    ["linux", "x64"],
    ["linux", "x86_64"],
    ["linux", "aarch64"],
    ["linux", "riscv64"],
    ["linux", "386"],
    ["windows", "amd64"],
    ["freebsd", "arm64"],
  ])
    assert.ok(validateMachineFacts({ ...mac, os, arch }).os, `${os} ${arch}`)

  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await syncMemberships(db, inAcme(), sync)
  // Go calls it amd64. The pool matches jobs to machines on what is stored,
  // so it is stored as the labels spell it.
  const box = await enrollMachine(db, inAcme(), {
    userId: "ada",
    organizationIds: [orgId],
    facts: {
      ...mac,
      name: "build box",
      model: "KVM",
      os: "linux",
      arch: "amd64",
    },
  })
  assert.equal(box.ok, true)
  const row = sqlite.prepare("select os, arch from machine").get()
  assert.deepEqual({ ...row }, { os: "linux", arch: "x64" })
})

test("one machine serves several organizations, each authorized separately", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  await provisionInstallation(db, globex)
  person(sqlite, "ada", 1)
  person(sqlite, "bob", 2)
  await syncMemberships(db, inAcme(), sync)

  // She asks for both pools but belongs to one: she gets that one, and is
  // told about the other.
  const enrolled = await enrollMachine(db, inAcme(), {
    userId: "ada",
    organizationIds: [orgId, globexId],
    facts: mac,
  })
  assert.deepEqual(enrolled.joined, [orgId])
  assert.deepEqual(
    enrolled.refused.map((refusal) => refusal.organizationId),
    [globexId]
  )
  const pools = async () =>
    (await listMachinePools(db, enrolled.machineId)).map((pool) => pool.name)
  assert.deepEqual(await pools(), ["acme"])
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, globexId),
    null
  )

  // Later she joins globex on GitHub, and adds the same machine from the
  // dashboard: same token, nothing reinstalled.
  const add = {
    userId: "ada",
    machineId: enrolled.machineId,
    organizationId: globexId,
  }
  assert.equal((await addMachineToPool(db, inAcme(), add)).code, "NOT_FOUND")
  await syncMemberships(db, inBoth(), sync)
  assert.equal(await addMachineToPool(db, inBoth(), add), null)
  assert.equal(
    await addMachineToPool(db, inBoth(), add),
    null,
    "adding twice is harmless"
  )
  assert.deepEqual((await pools()).sort(), ["acme", "globex"])
  assert.ok(await authenticateMachineForPool(db, enrolled.token, globexId))
  assert.equal((await listMachines(db, globexId)).length, 1)

  // Nobody else can volunteer her machine.
  assert.equal(
    (await addMachineToPool(db, inBoth(), { ...add, userId: "bob" })).code,
    "NOT_FOUND"
  )

  // Leaving acme takes the machine out of acme only.
  await syncMemberships(
    db,
    github({
      viewer,
      installations: [9001, 9002],
      roles: { "globex/ada": "member" },
    }),
    sync
  )
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, orgId),
    null
  )
  assert.ok(await authenticateMachineForPool(db, enrolled.token, globexId))
  assert.deepEqual(await pools(), ["globex"])

  // Rejoining acme and adding it back reuses the row.
  await syncMemberships(db, inBoth(), sync)
  assert.equal(
    await addMachineToPool(db, inBoth(), { ...add, organizationId: orgId }),
    null
  )
  assert.ok(await authenticateMachineForPool(db, enrolled.token, orgId))

  // An owner can drop it from their pool without touching the other.
  assert.equal(
    await removeMachineFromPool(db, {
      machineId: enrolled.machineId,
      organizationId: globexId,
    }),
    true
  )
  assert.equal(
    await removeMachineFromPool(db, {
      machineId: enrolled.machineId,
      organizationId: globexId,
    }),
    false
  )
  assert.deepEqual(await pools(), ["acme"])
})

test("leaving the organization takes that person's machines out of its pool", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await syncMemberships(db, inAcme(), sync)
  const input = { userId: "ada", organizationIds: [orgId], facts: mac }

  const first = await enrollMachine(db, inAcme(), input)
  await syncMemberships(db, github({ viewer, installations: [9001] }), sync)
  assert.equal(await authenticateMachineForPool(db, first.token, orgId), null)

  await syncMemberships(db, inAcme(), sync)
  const second = await enrollMachine(db, inAcme(), input)
  await applyGitHubEvent(db, {
    deliveryId: "bye",
    event: "organization",
    payload: {
      action: "member_removed",
      organization: { id: 501, login: "acme" },
      membership: { user: { id: 1 } },
    },
  })
  assert.equal(await authenticateMachineForPool(db, second.token, orgId), null)
})

test("a person cannot fill a pool with machines", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await syncMemberships(db, inAcme(), sync)
  const input = { userId: "ada", organizationIds: [orgId], facts: mac }
  for (let i = 0; i < MAX_MACHINES_PER_PERSON; i++)
    assert.equal((await enrollMachine(db, inAcme(), input)).ok, true)
  assert.equal((await enrollMachine(db, inAcme(), input)).code, "CONFLICT")
})

test("a refused machine is told which thing stands in its way", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  await syncMemberships(db, inAcme(), sync)
  const input = { userId: "ada", organizationIds: [orgId], facts: mac }
  await updatePoolSettings(db, orgId, {
    allowedTeams: ["ci"],
    earningsDestination: "developer",
    macosJobs: false,
    routing: "fastest",
    version: 1,
  })
  const teams = await enrollMachine(db, inAcme(), input)
  assert.equal(teams.code, "FORBIDDEN")
  assert.match(teams.message, /acme limits machines to certain teams/)
  // Still a member here, but GitHub no longer says so.
  const gone = await enrollMachine(db, github({ viewer }), input)
  assert.match(gone.message, /GitHub does not list you as a member of acme/)
  await provisionInstallation(db, { ...acme, suspended: true })
  const paused = await enrollMachine(db, inAcme(), input)
  assert.match(paused.message, /acme is not taking machines/)
})

const ownsBoth = () =>
  github({
    viewer,
    installations: [9001, 9002],
    roles: { "acme/ada": "admin", "globex/ada": "admin" },
  })
const names = (added) => added.map((row) => row.name).sort()

test("several machines are added at once, each decided separately", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  await provisionInstallation(db, globex)
  person(sqlite, "ada", 1)
  person(sqlite, "bob", 2)
  await syncMemberships(db, inBoth(), sync)
  await syncMemberships(
    db,
    github({
      viewer: { id: 2, login: "bob" },
      installations: [9001],
      roles: { "acme/bob": "member" },
    }),
    { userId: "bob", userToken: "token" }
  )
  const enroll = (userId, name) =>
    enrollMachine(db, inBoth(), {
      userId,
      organizationIds: [orgId],
      facts: { ...mac, name },
    })
  const one = await enroll("ada", "one")
  const two = await enroll("ada", "two")
  const gone = await enroll("ada", "gone")
  const bobs = await enroll("bob", "bob's")
  await revokeMachine(db, gone.machineId)

  const result = await addMachinesToPool(db, inBoth(), {
    userId: "ada",
    machineIds: [
      one.machineId,
      bobs.machineId,
      two.machineId,
      gone.machineId,
      "no-such-machine",
      one.machineId,
    ],
    organizationId: globexId,
  })
  assert.deepEqual(result.added, [one.machineId, two.machineId])
  assert.deepEqual(
    result.refused.map((refusal) => [refusal.machineId, refusal.code]),
    [
      [bobs.machineId, "NOT_FOUND"],
      [gone.machineId, "NOT_FOUND"],
      ["no-such-machine", "NOT_FOUND"],
    ]
  )
  assert.equal((await listMachines(db, globexId)).length, 2)
  assert.equal(await authenticateMachineForPool(db, bobs.token, globexId), null)

  // A hive she may not add to refuses every one, and adds none.
  assert.equal(
    await updatePoolSettings(db, globexId, {
      allowedTeams: ["ci"],
      earningsDestination: "developer",
      macosJobs: false,
      routing: "fastest",
      version: 1,
    }),
    true
  )
  await removeMachineFromPool(db, {
    machineId: one.machineId,
    organizationId: globexId,
  })
  const closed = await addMachinesToPool(db, inBoth(), {
    userId: "ada",
    machineIds: [one.machineId],
    organizationId: globexId,
  })
  assert.deepEqual(closed.added, [])
  assert.equal(closed.refused[0].code, "FORBIDDEN")
})

test("auto-join is its owner's to set, and off until they do", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  person(sqlite, "bob", 2)
  await syncMemberships(db, inAcme(), sync)
  const enrolled = await enrollMachine(db, inAcme(), {
    userId: "ada",
    organizationIds: [orgId],
    facts: mac,
  })
  const setting = async () =>
    (await listUserMachines(db, "ada")).map((row) => row.autoJoin)
  assert.deepEqual(await setting(), [false])

  const set = (userId, autoJoin, machineId = enrolled.machineId) =>
    setMachineAutoJoin(db, { userId, machineId, autoJoin })
  // Nobody else can turn it on, and they learn nothing about the machine.
  assert.equal((await set("bob", true)).code, "NOT_FOUND")
  assert.equal((await set("ada", true, "no-such-machine")).code, "NOT_FOUND")
  assert.deepEqual(await setting(), [false])

  assert.equal(await set("ada", true), null)
  assert.deepEqual(await setting(), [true])
  assert.equal(await set("ada", false), null)
  assert.deepEqual(await setting(), [false])

  await revokeMachine(db, enrolled.machineId)
  assert.equal((await set("ada", true)).code, "NOT_FOUND")
})

test("auto-join adds a machine to a hive its owner newly owns, and to no other", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const first = await syncMemberships(db, inAcme(), sync)
  assert.deepEqual(first.joined, [{ organizationId: orgId, role: "member" }])
  const input = { userId: "ada", organizationIds: [orgId] }
  const auto = await enrollMachine(db, inAcme(), {
    ...input,
    facts: { ...mac, name: "auto" },
  })
  const manual = await enrollMachine(db, inAcme(), {
    ...input,
    facts: { ...mac, name: "manual" },
  })
  await setMachineAutoJoin(db, {
    userId: "ada",
    machineId: auto.machineId,
    autoJoin: true,
  })

  // Globex installs, and she is an admin of it on GitHub.
  await provisionInstallation(db, globex)
  const gh = github({
    viewer,
    installations: [9001, 9002],
    roles: { "acme/ada": "member", "globex/ada": "admin" },
  })
  const synced = await syncMemberships(db, gh, sync)
  assert.deepEqual(synced.joined, [{ organizationId: globexId, role: "owner" }])
  const added = await autoJoinMachines(db, gh, {
    userId: "ada",
    joined: synced.joined,
  })
  assert.deepEqual(added, [
    { machineId: auto.machineId, name: "auto", organizationId: globexId },
  ])
  assert.ok(await authenticateMachineForPool(db, auto.token, globexId))
  assert.equal(
    await authenticateMachineForPool(db, manual.token, globexId),
    null
  )

  // What the page she lands on may say: one joined by itself, one is left.
  assert.deepEqual(
    await joinedHives(db, {
      userId: "ada",
      organizationIds: [globexId, orgId, "gh-0"],
    }),
    [
      {
        organizationId: globexId,
        login: "globex",
        autoJoined: ["auto"],
        missing: 1,
      },
      // She only belongs to acme, so nothing there is called auto-joined.
      { organizationId: orgId, login: "acme", autoJoined: [], missing: 0 },
    ]
  )
  // The link that carried the news goes quiet.
  assert.deepEqual(
    await joinedHives(
      db,
      { userId: "ada", organizationIds: [globexId, orgId] },
      new Date(Date.now() + JOINED_NOTICE_MS + 60_000)
    ),
    []
  )

  // The next sign-in joins nothing new, so nothing is added again: a
  // machine she takes out of the hive stays out.
  await removeMachineFromPool(db, {
    machineId: auto.machineId,
    organizationId: globexId,
  })
  const again = await syncMemberships(db, gh, sync)
  assert.deepEqual(again.joined, [])
  assert.deepEqual(
    await autoJoinMachines(db, gh, { userId: "ada", joined: again.joined }),
    []
  )
  assert.equal(await authenticateMachineForPool(db, auto.token, globexId), null)
})

test("auto-join never reaches a hive its owner is only a member of", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const admin = github({
    viewer,
    installations: [9001],
    roles: { "acme/ada": "admin" },
  })
  await syncMemberships(db, admin, sync)
  const enrolled = await enrollMachine(db, admin, {
    userId: "ada",
    organizationIds: [orgId],
    facts: mac,
  })
  await setMachineAutoJoin(db, {
    userId: "ada",
    machineId: enrolled.machineId,
    autoJoin: true,
  })

  await provisionInstallation(db, globex)
  const gh = github({
    viewer,
    installations: [9001, 9002],
    roles: { "acme/ada": "admin", "globex/ada": "member" },
  })
  const synced = await syncMemberships(db, gh, sync)
  assert.deepEqual(synced.joined, [
    { organizationId: globexId, role: "member" },
  ])
  assert.deepEqual(
    await autoJoinMachines(db, gh, { userId: "ada", joined: synced.joined }),
    []
  )
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, globexId),
    null
  )
  // She is pointed at the hive instead, and nothing is called auto-joined.
  assert.deepEqual(
    await joinedHives(db, { userId: "ada", organizationIds: [globexId] }),
    [
      {
        organizationId: globexId,
        login: "globex",
        autoJoined: [],
        missing: 1,
      },
    ]
  )

  // Being promoted there later is not newly joining it.
  const promoted = await syncMemberships(db, ownsBoth(), sync)
  assert.deepEqual(promoted.joined, [])
  assert.deepEqual(members(sqlite), [
    `ada:${orgId}:owner`,
    `ada:${globexId}:owner`,
  ])
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, globexId),
    null
  )
})

test("turning auto-join on does not reach hives already joined", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  await provisionInstallation(db, globex)
  person(sqlite, "ada", 1)
  const joined = await syncMemberships(db, ownsBoth(), sync)
  assert.equal(joined.joined.length, 2)
  const enrolled = await enrollMachine(db, ownsBoth(), {
    userId: "ada",
    organizationIds: [orgId],
    facts: mac,
  })
  await setMachineAutoJoin(db, {
    userId: "ada",
    machineId: enrolled.machineId,
    autoJoin: true,
  })
  const synced = await syncMemberships(db, ownsBoth(), sync)
  assert.deepEqual(synced.joined, [])
  assert.deepEqual(
    await autoJoinMachines(db, ownsBoth(), {
      userId: "ada",
      joined: synced.joined,
    }),
    []
  )
  assert.equal(
    await authenticateMachineForPool(db, enrolled.token, globexId),
    null
  )
})

test("auto-join stops at the machine limit and survives a GitHub error", async (t) => {
  const { db, sqlite } = database(t)
  await provisionInstallation(db, acme)
  person(sqlite, "ada", 1)
  const admin = github({
    viewer,
    installations: [9001],
    roles: { "acme/ada": "admin" },
  })
  await syncMemberships(db, admin, sync)
  // More machines than one hive takes from one person, spread over time so
  // that no single enrollment is over the limit.
  const total = MAX_MACHINES_PER_PERSON + 2
  for (let i = 0; i < total; i++) {
    const enrolled = await enrollMachine(db, admin, {
      userId: "ada",
      organizationIds: [orgId],
      facts: { ...mac, name: `mac ${i}` },
    })
    assert.equal(enrolled.ok, true)
    await setMachineAutoJoin(db, {
      userId: "ada",
      machineId: enrolled.machineId,
      autoJoin: true,
    })
    if (i >= MAX_MACHINES_PER_PERSON - 1)
      await removeMachineFromPool(db, {
        machineId: enrolled.machineId,
        organizationId: orgId,
      })
  }

  await provisionInstallation(db, globex)
  const synced = await syncMemberships(db, ownsBoth(), sync)
  assert.deepEqual(synced.joined, [{ organizationId: globexId, role: "owner" }])

  // GitHub cannot be asked: nothing is added, nothing is refused for good,
  // and the caller hears of each failure instead of the sign-in failing.
  const errors = []
  const down = { ...ownsBoth(), getLogin: async () => viewer.login }
  down.getOrgRole = async () => {
    throw new GitHubError(502, "GitHub responded 502")
  }
  assert.deepEqual(
    await autoJoinMachines(db, down, {
      userId: "ada",
      joined: synced.joined,
      onError: (error) => errors.push(error),
    }),
    []
  )
  assert.equal(errors.length, total)
  assert.equal((await listMachines(db, globexId)).length, 0)

  const added = await autoJoinMachines(db, ownsBoth(), {
    userId: "ada",
    joined: synced.joined,
  })
  assert.equal(added.length, MAX_MACHINES_PER_PERSON)
  assert.equal(
    (await listMachines(db, globexId)).length,
    MAX_MACHINES_PER_PERSON
  )
  assert.equal(names(added).length, new Set(names(added)).size)
})
