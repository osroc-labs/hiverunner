import { and, eq, gte, inArray, sql } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"
import { BUDGET_MAX_USD, MICRO } from "@workspace/pricing"

import { ledgerEntry, spendBudget } from "@workspace/db/schema"

/**
 * What a hive spends on jobs in a calendar month, and the budget it may set
 * against that.
 *
 * Spend is what jobs cost the hive's own account: what it was charged, less
 * what its own machines earned back into the same account. Money added to
 * the balance is not spend, and neither is what a member's machine earned
 * for the member.
 */

/** Ledger amounts are millionths of a dollar; a budget is kept in cents. */
const centsToLedger = (cents: number) => (cents * MICRO) / 100

/** The first instant of the calendar month `now` is in, UTC. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** `2026-10`: the name a month's notices are kept under. */
export function monthName(now = new Date()) {
  return monthStart(now).toISOString().slice(0, 7)
}

/** What jobs have cost an organization so far this month, in micro-tokens. */
export async function spentThisMonth(
  db: AuthDb,
  organizationId: string,
  now = new Date()
) {
  const [row] = await db
    .select({
      net: sql<number>`coalesce(sum(${ledgerEntry.amount}), 0)`.as("net"),
    })
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.accountType, "organization"),
        eq(ledgerEntry.accountId, organizationId),
        inArray(ledgerEntry.kind, ["charge", "earning"]),
        gte(ledgerEntry.createdAt, monthStart(now))
      )
    )
  return Math.max(0, -Number(row?.net ?? 0))
}

export function getBudget(db: AuthDb, organizationId: string) {
  return db
    .select()
    .from(spendBudget)
    .where(eq(spendBudget.organizationId, organizationId))
    .limit(1)
    .then(([row]) => row ?? null)
}

/** Whether a budget, in whole dollars, is one a hive may set. */
export function budgetAllowed(dollars: unknown): dollars is number {
  return (
    typeof dollars === "number" &&
    Number.isInteger(dollars) &&
    dollars >= 1 &&
    dollars <= BUDGET_MAX_USD
  )
}

/** Sets a hive's monthly budget, or with `dollars: null` removes it. */
export async function setBudget(
  db: AuthDb,
  input: {
    organizationId: string
    dollars: number | null
    atLimit?: "warn" | "pause"
    now?: Date
  }
) {
  if (input.dollars === null) {
    await db
      .delete(spendBudget)
      .where(eq(spendBudget.organizationId, input.organizationId))
    return null
  }
  if (!budgetAllowed(input.dollars))
    throw new Error("A budget is a whole number of dollars")
  const atLimit = input.atLimit ?? "warn"
  if (atLimit !== "warn" && atLimit !== "pause")
    throw new Error("Choose what happens at the limit")
  const row = {
    monthlyCents: input.dollars * 100,
    atLimit,
    updatedAt: input.now ?? new Date(),
  }
  await db
    .insert(spendBudget)
    .values({ organizationId: input.organizationId, ...row })
    .onConflictDoUpdate({ target: spendBudget.organizationId, set: row })
  return getBudget(db, input.organizationId)
}

/**
 * Whether a hive asked for new jobs to be held at its budget and has now
 * spent it. A budget that only warns never holds anything.
 */
export async function budgetHolds(
  db: AuthDb,
  organizationId: string,
  now = new Date()
) {
  const budget = await getBudget(db, organizationId)
  if (budget?.atLimit !== "pause") return false
  return (
    (await spentThisMonth(db, organizationId, now)) >=
    centsToLedger(budget.monthlyCents)
  )
}
