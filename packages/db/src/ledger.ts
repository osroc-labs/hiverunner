import { and, desc, eq, sql } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"

import { ledgerEntry } from "@workspace/db/schema"

type Account = {
  accountType: "organization" | "user" | "treasury"
  accountId: string
}

const owned = (account: Account) =>
  and(
    eq(ledgerEntry.accountType, account.accountType),
    eq(ledgerEntry.accountId, account.accountId)
  )

/** Micro-tokens. Always computed; there is no stored balance to trust. */
export async function getBalance(db: AuthDb, account: Account) {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${ledgerEntry.amount}), 0)`.as(
        "balance"
      ),
    })
    .from(ledgerEntry)
    .where(owned(account))
  return Number(row?.balance ?? 0)
}

export async function listEntries(db: AuthDb, account: Account, limit = 50) {
  return db
    .select()
    .from(ledgerEntry)
    .where(owned(account))
    .orderBy(desc(ledgerEntry.createdAt), desc(ledgerEntry.id))
    .limit(Math.min(Math.max(limit, 1), 200))
}
