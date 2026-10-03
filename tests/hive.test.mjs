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
  updatePoolSettings,
  validatePoolSettings,
} from "../packages/db/src/settings.ts"
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
    version: 1,
  }
  assert.equal(await updatePoolSettings(db, orgId, change), true)
  assert.equal(await updatePoolSettings(db, orgId, change), false)
  assert.equal((await getPoolSettings(db, orgId)).version, 2)
  assert.equal(validatePoolSettings(change), null)
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
