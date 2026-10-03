import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { organization } from "@workspace/auth/schema"

/**
 * One row per GitHub App installation. The organization row is created from
 * it and never the other way round: a pool exists because the App was
 * installed, and for no other reason.
 */
export const githubInstallation = sqliteTable(
  "github_installation",
  {
    /**
     * GitHub's id for the account the App is installed on. The key, because a
     * reinstall gets a new installation id for the same account and must land
     * on the same organization and ledger.
     */
    accountId: integer("account_id").primaryKey(),
    installationId: integer("installation_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["Organization", "User"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    status: text("status", { enum: ["active", "suspended", "removed"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("github_installation_org_idx").on(table.organizationId),
    uniqueIndex("github_installation_installation_idx").on(
      table.installationId
    ),
  ]
)

export const poolSettings = sqliteTable("pool_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Empty means every member of the GitHub organization may add machines. */
  allowedTeams: text("allowed_teams", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  /** Who is paid when a member's machine runs a job. */
  earningsDestination: text("earnings_destination", {
    enum: ["organization", "developer"],
  })
    .notNull()
    .default("organization"),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

/**
 * Append-only. A balance is the sum of an account's entries; nothing stores a
 * mutable balance, so there is nothing to drift.
 *
 * Amounts are signed micro-tokens: positive credits the account.
 */
export const ledgerEntry = sqliteTable(
  "ledger_entry",
  {
    /**
     * Deterministic where the entry must happen once: `grant:<org>` cannot be
     * inserted twice however many times the install webhook is delivered.
     */
    id: text("id").primaryKey(),
    accountType: text("account_type", {
      enum: ["organization", "user", "treasury"],
    }).notNull(),
    /** Organization or user id; `treasury` for the treasury. */
    accountId: text("account_id").notNull(),
    kind: text("kind", {
      enum: ["grant", "purchase", "charge", "earning", "tax"],
    }).notNull(),
    amount: integer("amount").notNull(),
    jobId: text("job_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("ledger_entry_account_idx").on(
      table.accountType,
      table.accountId,
      table.createdAt
    ),
  ]
)

/** GitHub redelivers. The delivery id makes handling a webhook idempotent. */
export const webhookDelivery = sqliteTable("webhook_delivery", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
})
