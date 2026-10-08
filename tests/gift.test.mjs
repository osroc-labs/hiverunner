import assert from "node:assert/strict"
import { test } from "node:test"
import { database } from "./database.mjs"
import { countGifts, openGift } from "../packages/db/src/gift.ts"
import {
  getBalance,
  listEntries,
  recordPurchase,
} from "../packages/db/src/ledger.ts"
import {
  GIFT_PRIZES,
  GIFT_ROLLS,
  giftAmount,
  giftPrize,
} from "../packages/pricing/src/index.ts"

const account = { accountType: "organization", accountId: "org_1" }
const now = new Date("2026-10-07T12:00:00Z")
const buy = (db, paymentId, cents = 2500, extra = {}) =>
  recordPurchase(db, {
    organizationId: "org_1",
    paymentId,
    cents,
    now,
    ...extra,
  })

test("every roll lands on a prize, as often as its weight says", () => {
  const landed = GIFT_PRIZES.map(() => 0)
  for (let roll = 0; roll < GIFT_ROLLS; roll++) landed[giftPrize(roll)]++
  assert.deepEqual(
    landed,
    GIFT_PRIZES.map((prize) => prize.weight)
  )
  for (const roll of [-1, GIFT_ROLLS, 0.5])
    assert.throws(() => giftPrize(roll), /roll/)
  // Generous, but never worth more on average than what was paid for it.
  const average = GIFT_PRIZES.reduce(
    (sum, prize) => sum + (prize.share * prize.weight) / GIFT_ROLLS,
    0
  )
  assert.ok(average > 0.2 && average < 0.25, String(average))
})

test("a gift is a share of what was paid, to the whole cent", () => {
  assert.equal(giftAmount(25_000_000, 0), 1_250_000)
  assert.equal(giftAmount(25_000_000, GIFT_PRIZES.length - 1), 125_000_000)
  // 5% of $10.50 is 52.5 cents.
  assert.equal(giftAmount(10_500_000, 0), 530_000)
  // Five times $100 is more than one gift may be.
  assert.equal(giftAmount(100_000_000, GIFT_PRIZES.length - 1), 250_000_000)
})

test("a payment by card comes with one gift, opened once", async (t) => {
  const { db } = database(t)
  assert.equal(await countGifts(db, "org_1", now), 0)
  assert.equal(await openGift(db, { organizationId: "org_1", now }), null)

  await buy(db, "cs_test_1")
  assert.equal(await countGifts(db, "org_1", now), 1)
  const gift = await openGift(db, { organizationId: "org_1", roll: 0, now })
  assert.deepEqual(gift, {
    prize: 0,
    amount: 1_250_000,
    capped: false,
    paid: 25_000_000,
    left: 0,
  })
  assert.equal(await getBalance(db, account), 26_250_000)
  const [entry] = (await listEntries(db, account)).filter(
    (row) => row.kind === "gift"
  )
  assert.equal(entry.id, "gift:purchase:cs_test_1")

  assert.equal(await countGifts(db, "org_1", now), 0)
  assert.equal(
    await openGift(db, { organizationId: "org_1", roll: 999, now }),
    null
  )
  assert.equal(await getBalance(db, account), 26_250_000)
})

test("gifts are opened oldest first, and the rarest is five times the payment", async (t) => {
  const { db } = database(t)
  await buy(db, "cs_test_b", 2500, { now: new Date(now.getTime() - 1000) })
  await buy(db, "cs_test_a", 1000)
  const first = await openGift(db, {
    organizationId: "org_1",
    roll: GIFT_ROLLS - 1,
    now,
  })
  assert.equal(first.prize, GIFT_PRIZES.length - 1)
  assert.equal(first.amount, 125_000_000)
  assert.equal(first.capped, false)
  assert.equal(first.left, 1)
  const second = await openGift(db, { organizationId: "org_1", roll: 0, now })
  assert.equal(second.paid, 10_000_000)
  assert.equal(second.left, 0)
})

test("gifts stop at the month's ceiling, and wait for the next month", async (t) => {
  const { db } = database(t)
  const top = GIFT_ROLLS - 1
  for (const id of ["cs_test_1", "cs_test_2", "cs_test_3", "cs_test_4"])
    await buy(db, id, 10000)
  // $250 each: the most one gift can be, twice, is the month's $500.
  const first = await openGift(db, { organizationId: "org_1", roll: top, now })
  assert.equal(first.amount, 250_000_000)
  assert.equal(first.capped, true)
  assert.equal(first.left, 3)
  const second = await openGift(db, { organizationId: "org_1", roll: top, now })
  assert.equal(second.amount, 250_000_000)
  assert.equal(second.left, 0)
  assert.equal(await countGifts(db, "org_1", now), 0)
  assert.equal(await openGift(db, { organizationId: "org_1", now }), null)
  assert.equal(await getBalance(db, account), 900_000_000)

  // The two unopened gifts are still there when the month turns.
  const november = new Date("2026-11-01T00:00:00Z")
  assert.equal(await countGifts(db, "org_1", november), 2)
  const third = await openGift(db, {
    organizationId: "org_1",
    roll: 0,
    now: november,
  })
  assert.equal(third.amount, 5_000_000)
  assert.equal(third.capped, false)
})

test("a gift is cut to what is left of the month's ceiling", async (t) => {
  const { db } = database(t)
  const top = GIFT_ROLLS - 1
  await buy(db, "cs_test_1", 10000)
  await buy(db, "cs_test_2", 5000)
  await buy(db, "cs_test_3", 10000)
  await openGift(db, { organizationId: "org_1", roll: top, now })
  // $50 at the fifth prize is $50, leaving $200 of the month's $500.
  await openGift(db, { organizationId: "org_1", roll: top - 10, now })
  const last = await openGift(db, { organizationId: "org_1", roll: top, now })
  assert.equal(last.amount, 200_000_000)
  assert.equal(last.capped, true)
})

test("a prize is decided without being told one", async (t) => {
  const { db } = database(t)
  await buy(db, "cs_test_1")
  const gift = await openGift(db, { organizationId: "org_1", now })
  assert.ok(gift.prize >= 0 && gift.prize < GIFT_PRIZES.length)
  assert.equal(gift.amount, giftAmount(25_000_000, gift.prize))
})

test("only a payment made by hand, lately, by this organization has a gift", async (t) => {
  const { db } = database(t)
  // An automatic top-up, keyed by its PaymentIntent.
  await buy(db, "pi_auto_1")
  // Paid for too long ago.
  await buy(db, "cs_test_old", 2500, {
    now: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
  })
  // Somebody else's.
  await recordPurchase(db, {
    organizationId: "org_2",
    paymentId: "cs_test_other",
    cents: 2500,
    now,
  })
  assert.equal(await countGifts(db, "org_1", now), 0)
  assert.equal(await openGift(db, { organizationId: "org_1", now }), null)
  assert.equal(await countGifts(db, "org_2", now), 1)
})
