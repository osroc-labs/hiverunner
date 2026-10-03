import { and, eq } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"
import { account, member, organization } from "@workspace/auth/schema"
import type { Installation } from "@workspace/github"
import { TRIAL_GRANT_USD, usdToMicroTokens } from "@workspace/pricing"

import {
  githubInstallation,
  ledgerEntry,
  poolSettings,
  webhookDelivery,
} from "@workspace/db/schema"

/**
 * Derived, not generated, so that two deliveries of the same install racing
 * each other write the same organization rather than one each.
 */
export const organizationIdFor = (accountId: number) => `gh-${accountId}`

export type ProvisionResult =
  | { supported: true; organizationId: string }
  | { supported: false; reason: "personal-account" }

/**
 * Everything an installation creates: the organization, its pool settings and
 * its trial grant. Every statement is idempotent, so the webhook and the
 * browser's return from GitHub can both call this in either order, any number
 * of times.
 */
export async function provisionInstallation(
  db: AuthDb,
  installation: Installation,
  now = new Date()
): Promise<ProvisionResult> {
  // Organization-level scale sets do not exist for personal accounts.
  if (installation.account.type !== "Organization")
    return { supported: false, reason: "personal-account" }

  const organizationId = organizationIdFor(installation.account.id)
  const status = installation.suspended ? "suspended" : "active"

  await db
    .insert(organization)
    .values({
      id: organizationId,
      name: installation.account.login,
      // Logins are reused after a rename; the account id is not.
      slug: organizationId,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: organization.id,
      set: { name: installation.account.login },
    })
  await db
    .insert(githubInstallation)
    .values({
      accountId: installation.account.id,
      installationId: installation.id,
      organizationId,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      repositorySelection: installation.repositorySelection,
      status,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubInstallation.accountId,
      set: {
        installationId: installation.id,
        accountLogin: installation.account.login,
        repositorySelection: installation.repositorySelection,
        status,
        updatedAt: now,
      },
    })
  await db
    .insert(poolSettings)
    .values({ organizationId, updatedAt: now })
    .onConflictDoNothing()
  // One grant per GitHub account, ever. Uninstalling and reinstalling keeps
  // the same organization id, so it cannot be claimed twice.
  await db
    .insert(ledgerEntry)
    .values({
      id: `grant:${organizationId}`,
      accountType: "organization",
      accountId: organizationId,
      kind: "grant",
      amount: usdToMicroTokens(TRIAL_GRANT_USD),
      createdAt: now,
    })
    .onConflictDoNothing()

  return { supported: true, organizationId }
}

export async function setInstallationStatus(
  db: AuthDb,
  installationId: number,
  status: "active" | "suspended" | "removed",
  now = new Date()
) {
  await db
    .update(githubInstallation)
    .set({ status, updatedAt: now })
    .where(eq(githubInstallation.installationId, installationId))
}

export async function renameAccount(
  db: AuthDb,
  accountId: number,
  login: string,
  now = new Date()
) {
  await db
    .update(githubInstallation)
    .set({ accountLogin: login, updatedAt: now })
    .where(eq(githubInstallation.accountId, accountId))
  await db
    .update(organization)
    .set({ name: login })
    .where(eq(organization.id, organizationIdFor(accountId)))
}

/** Someone left or was removed from the GitHub organization. */
export async function removeGitHubMember(
  db: AuthDb,
  input: { accountId: number; memberAccountId: number }
) {
  const [linked] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, "github"),
        eq(account.accountId, String(input.memberAccountId))
      )
    )
    .limit(1)
  if (!linked) return false
  await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, organizationIdFor(input.accountId)),
        eq(member.userId, linked.userId)
      )
    )
  return true
}

export async function getInstallationByOrganization(
  db: AuthDb,
  organizationId: string
) {
  const [row] = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, organizationId))
    .limit(1)
  return row ?? null
}

export async function getInstallationById(db: AuthDb, installationId: number) {
  const [row] = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1)
  return row ?? null
}

type RawAccount = { id: number; login: string; type: string }

export type GitHubEvent = {
  /** `X-GitHub-Delivery`. */
  deliveryId: string
  /** `X-GitHub-Event`. */
  event: string
  payload: {
    action?: string
    installation?: {
      id: number
      account?: RawAccount
      suspended_at?: string | null
      repository_selection?: string
    }
    organization?: { id: number; login: string }
    membership?: { user?: { id: number } }
    account?: RawAccount
    changes?: { login?: { from?: string } }
  }
}

/**
 * Applies one verified webhook. Returns what it did, for the log line.
 *
 * The delivery is recorded only after it has been applied, so a failure part
 * way through is retried on redelivery instead of being skipped as a
 * duplicate. That is safe because every handler here is idempotent.
 */
export async function applyGitHubEvent(
  db: AuthDb,
  { deliveryId, event, payload }: GitHubEvent,
  now = new Date()
) {
  const [seen] = await db
    .select({ id: webhookDelivery.id })
    .from(webhookDelivery)
    .where(eq(webhookDelivery.id, deliveryId))
    .limit(1)
  if (seen) return "duplicate"

  let outcome = "ignored"
  const { action, installation } = payload

  if (event === "installation" && installation) {
    if (
      installation.account &&
      (action === "created" ||
        action === "unsuspend" ||
        action === "new_permissions_accepted")
    ) {
      const result = await provisionInstallation(
        db,
        {
          id: installation.id,
          account: {
            id: installation.account.id,
            login: installation.account.login,
            type:
              installation.account.type === "Organization"
                ? "Organization"
                : "User",
          },
          suspended: Boolean(installation.suspended_at),
          repositorySelection:
            installation.repository_selection === "selected"
              ? "selected"
              : "all",
        },
        now
      )
      outcome = result.supported ? "provisioned" : "unsupported"
    } else if (action === "deleted") {
      await setInstallationStatus(db, installation.id, "removed", now)
      outcome = "removed"
    } else if (action === "suspend") {
      await setInstallationStatus(db, installation.id, "suspended", now)
      outcome = "suspended"
    }
  } else if (
    event === "organization" &&
    action === "member_removed" &&
    payload.organization &&
    payload.membership?.user
  ) {
    const removed = await removeGitHubMember(db, {
      accountId: payload.organization.id,
      memberAccountId: payload.membership.user.id,
    })
    outcome = removed ? "member-removed" : "ignored"
  } else if (
    event === "installation_target" &&
    action === "renamed" &&
    payload.account
  ) {
    await renameAccount(db, payload.account.id, payload.account.login, now)
    outcome = "renamed"
  }

  await db
    .insert(webhookDelivery)
    .values({ id: deliveryId, event, receivedAt: now })
    .onConflictDoNothing()
  return outcome
}
