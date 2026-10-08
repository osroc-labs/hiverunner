import { and, asc, eq, gte, notExists, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import type { AuthDb } from "@workspace/auth/db"
import {
  GIFT_MONTHLY_CAP_USD,
  GIFT_PRIZES,
  GIFT_ROLLS,
  GIFT_WINDOW_DAYS,
  giftAmount,
  giftPrize,
  usdToMicroTokens,
} from "@workspace/pricing"

import { ledgerEntry } from "@workspace/db/schema"

/**
 * The gift that comes with a card payment made by hand.
 *
 * A gift is not a row of its own. It is waiting while a Checkout purchase has
 * no `gift:<purchase id>` entry beside it, and opening it writes that entry,
 * so one payment can be opened once however many times it is asked for.
 * Automatic top-ups carry no gift: nobody is there to open one.
 *
 * An organization's gifts stop at a monthly ceiling. Past it a gift is not
 * lost: it waits, and can be opened next month if its payment is still
 * recent enough.
 */

const DAY = 24 * 60 * 60 * 1000

const opened = alias(ledgerEntry, "opened")

/** The purchases of an organization whose gift has not been opened. */
const waiting = (organizationId: string, now: Date) =>
  and(
    eq(ledgerEntry.accountType, "organization"),
    eq(ledgerEntry.accountId, organizationId),
    eq(ledgerEntry.kind, "purchase"),
    // An exact prefix, not LIKE: `_` is a wildcard there.
    sql`substr(${ledgerEntry.id}, 1, 12) = 'purchase:cs_'`,
    gte(
      ledgerEntry.createdAt,
      new Date(now.getTime() - GIFT_WINDOW_DAYS * DAY)
    ),
    notExists(
      sql`(select 1 from ${ledgerEntry} as ${opened} where ${opened.id} = 'gift:' || ${ledgerEntry.id})`
    )
  )

/** What an organization's gifts may still add up to this month. */
async function giftRoom(db: AuthDb, organizationId: string, now: Date) {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${ledgerEntry.amount}), 0)`.as("total"),
    })
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.accountType, "organization"),
        eq(ledgerEntry.accountId, organizationId),
        eq(ledgerEntry.kind, "gift"),
        gte(ledgerEntry.createdAt, monthStart)
      )
    )
  return Math.max(
    0,
    usdToMicroTokens(GIFT_MONTHLY_CAP_USD) - Number(row?.total ?? 0)
  )
}

/** How many gifts can be opened now: none once the month's ceiling is met. */
export async function countGifts(
  db: AuthDb,
  organizationId: string,
  now = new Date()
) {
  if (!(await giftRoom(db, organizationId, now))) return 0
  const [row] = await db
    .select({ gifts: sql<number>`count(*)`.as("gifts") })
    .from(ledgerEntry)
    .where(waiting(organizationId, now))
  return Number(row?.gifts ?? 0)
}

/** A whole number from 0 up to `GIFT_ROLLS`, each as likely as the next. */
function roll() {
  const word = new Uint32Array(1)
  // Words past the last whole multiple would favour the low rolls.
  const limit = Math.floor(2 ** 32 / GIFT_ROLLS) * GIFT_ROLLS
  do crypto.getRandomValues(word)
  while (word[0]! >= limit)
  return word[0]! % GIFT_ROLLS
}

/**
 * Opens the oldest gift an organization has waiting and credits what was in
 * it. Null when there is none, or when another request opened it first.
 *
 * The prize is decided here, on the server, before anything is drawn. What
 * the browser shows afterwards is a picture of a credit already made.
 */
export async function openGift(
  db: AuthDb,
  input: {
    organizationId: string
    /** Decides the prize. Left out everywhere but a test. */
    roll?: number
    now?: Date
  }
) {
  const now = input.now ?? new Date()
  const room = await giftRoom(db, input.organizationId, now)
  if (!room) return null
  const [purchase] = await db
    .select({ id: ledgerEntry.id, amount: ledgerEntry.amount })
    .from(ledgerEntry)
    .where(waiting(input.organizationId, now))
    .orderBy(asc(ledgerEntry.createdAt), asc(ledgerEntry.id))
    .limit(1)
  if (!purchase) return null
  const prize = giftPrize(input.roll ?? roll())
  const amount = Math.min(giftAmount(purchase.amount, prize), room)
  const written = await db
    .insert(ledgerEntry)
    .values({
      id: `gift:${purchase.id}`,
      accountType: "organization",
      accountId: input.organizationId,
      kind: "gift",
      amount,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: ledgerEntry.id })
  if (!written.length) return null
  return {
    prize,
    /** Micro-tokens, as everything in the ledger is. */
    amount,
    /** A ceiling, on one gift or on the month, made it less than its share. */
    capped: amount < Math.round(purchase.amount * GIFT_PRIZES[prize]!.share),
    paid: purchase.amount,
    left: await countGifts(db, input.organizationId, now),
  }
}
