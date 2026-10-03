import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { organization, user } from "@workspace/auth/schema"

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
 * A developer's computer, enrolled in one pool. The daemon holds the machine
 * token and nothing else; only its hash is stored, so a database read cannot
 * impersonate a machine.
 */
export const machine = sqliteTable(
  "machine",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Whose machine it is. Their leaving the organization revokes it. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model").notNull(),
    os: text("os").notNull(),
    arch: text("arch").notNull(),
    cores: integer("cores").notNull(),
    memoryBytes: integer("memory_bytes").notNull(),
    /**
     * Speed relative to one core of a GitHub standard hosted runner. Starts
     * from the daemon's own benchmark, which is a claim; the coordinator
     * corrects it against observed job durations.
     */
    speedScore: real("speed_score").notNull().default(1),
    daemonVersion: text("daemon_version").notNull(),
    /** SHA-256 of the machine token, hex. */
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("machine_org_idx").on(table.organizationId, table.status),
    index("machine_user_idx").on(table.userId),
    uniqueIndex("machine_token_idx").on(table.tokenHash),
  ]
)

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
