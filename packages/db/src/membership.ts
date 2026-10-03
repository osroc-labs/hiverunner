import { and, eq, inArray } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"
import { account, member, session } from "@workspace/auth/schema"
import type { GitHubApp } from "@workspace/github"

import { githubInstallation, machine, poolSettings } from "@workspace/db/schema"

/** The slice of the App this module needs; the tests pass a fake. */
export type MembershipSource = Pick<
  GitHubApp,
  "getViewer" | "listUserInstallationIds" | "getOrgRole" | "isTeamMember"
>

export type SyncResult = {
  /** Organizations the person belongs to after the sync. */
  organizationIds: string[]
}

/** Their machines go when they do. */
export async function revokeMachinesForUser(
  db: AuthDb,
  input: { organizationId: string; userId: string },
  now = new Date()
) {
  await db
    .update(machine)
    .set({ status: "revoked", revokedAt: now })
    .where(
      and(
        eq(machine.organizationId, input.organizationId),
        eq(machine.userId, input.userId),
        eq(machine.status, "active")
      )
    )
}

/**
 * Makes the `member` table agree with GitHub for one person.
 *
 * GitHub is the source of truth and `member` is a cache of it. Candidates are
 * the installations the person's own token can see, plus every pool they are
 * already cached in, so that losing sight of an installation never looks the
 * same as losing membership. Each candidate is then confirmed with the
 * installation's token.
 *
 * All of GitHub is asked before anything is written. An outage throws out of
 * here with the cache untouched; it must never be read as "remove everyone".
 */
export async function syncMemberships(
  db: AuthDb,
  github: MembershipSource,
  input: { userId: string; userToken: string },
  now = new Date()
): Promise<SyncResult> {
  const [linked] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.userId, input.userId), eq(account.providerId, "github"))
    )
    .limit(1)
  if (!linked) throw new Error("No linked GitHub account")

  const viewer = await github.getViewer(input.userToken)
  // The token must belong to the account we have on file for this person.
  if (String(viewer.id) !== linked.accountId)
    throw new Error("GitHub token does not match the linked account")

  const visible = await github.listUserInstallationIds(input.userToken)
  const cached = await db
    .select({
      id: member.id,
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.userId, input.userId))

  const candidates = new Map<string, typeof githubInstallation.$inferSelect>()
  // D1 allows 100 bound parameters per statement.
  for (let i = 0; i < visible.length; i += 50) {
    const rows = await db
      .select()
      .from(githubInstallation)
      .where(
        inArray(githubInstallation.installationId, visible.slice(i, i + 50))
      )
    for (const row of rows) candidates.set(row.organizationId, row)
  }
  const cachedIds = cached.map((row) => row.organizationId)
  for (let i = 0; i < cachedIds.length; i += 50) {
    const rows = await db
      .select()
      .from(githubInstallation)
      .where(
        inArray(githubInstallation.organizationId, cachedIds.slice(i, i + 50))
      )
    for (const row of rows) candidates.set(row.organizationId, row)
  }

  const confirmed = new Map<string, "owner" | "member">()
  for (const installation of candidates.values()) {
    if (installation.status !== "active") continue
    const role = await github.getOrgRole(
      installation.installationId,
      installation.accountLogin,
      viewer.login
    )
    if (role)
      confirmed.set(
        installation.organizationId,
        role === "admin" ? "owner" : "member"
      )
  }

  for (const [organizationId, role] of confirmed) {
    const existing = cached.find((row) => row.organizationId === organizationId)
    if (!existing)
      await db
        .insert(member)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          userId: input.userId,
          role,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [member.organizationId, member.userId],
          set: { role },
        })
    else if (existing.role !== role)
      await db.update(member).set({ role }).where(eq(member.id, existing.id))
  }
  // Only rows backed by an installation are ours to remove.
  const stale = cached.filter(
    (row) =>
      candidates.has(row.organizationId) && !confirmed.has(row.organizationId)
  )
  for (const row of stale) {
    await db.delete(member).where(eq(member.id, row.id))
    await revokeMachinesForUser(db, {
      organizationId: row.organizationId,
      userId: input.userId,
    })
  }

  return { organizationIds: [...confirmed.keys()] }
}

/**
 * Points the person's sessions at a pool they belong to. A session left on an
 * organization they were removed from would otherwise bounce on every page.
 */
export async function repairActiveOrganization(
  db: AuthDb,
  input: { userId: string; organizationIds: string[]; prefer?: string }
) {
  const target =
    input.prefer && input.organizationIds.includes(input.prefer)
      ? input.prefer
      : undefined
  const sessions = await db
    .select({ id: session.id, active: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, input.userId))
  for (const row of sessions) {
    const valid = row.active && input.organizationIds.includes(row.active)
    const next =
      target ?? (valid ? row.active : (input.organizationIds[0] ?? null))
    if (next !== row.active)
      await db
        .update(session)
        .set({ activeOrganizationId: next })
        .where(eq(session.id, row.id))
  }
}

/**
 * Whether this person may add a machine to the pool. Owners always may; when
 * the pool is narrowed to teams, members need to be on one of them.
 */
export async function canAddMachines(
  db: AuthDb,
  github: Pick<GitHubApp, "isTeamMember" | "getOrgRole" | "getLogin">,
  input: { organizationId: string; userId: string }
) {
  const [installation] = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, input.organizationId))
    .limit(1)
  if (!installation || installation.status !== "active") return false
  const [linked] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.userId, input.userId), eq(account.providerId, "github"))
    )
    .limit(1)
  if (!linked) return false
  const login = await github.getLogin(
    installation.installationId,
    linked.accountId
  )
  if (!login) return false
  // Asked fresh every time: enrolling a machine is the moment that matters.
  const role = await github.getOrgRole(
    installation.installationId,
    installation.accountLogin,
    login
  )
  if (!role) return false
  if (role === "admin") return true
  const [settings] = await db
    .select({ allowedTeams: poolSettings.allowedTeams })
    .from(poolSettings)
    .where(eq(poolSettings.organizationId, input.organizationId))
    .limit(1)
  const teams = settings?.allowedTeams ?? []
  if (!teams.length) return true
  for (const team of teams)
    if (
      await github.isTeamMember(
        installation.installationId,
        installation.accountLogin,
        team,
        login
      )
    )
      return true
  return false
}
