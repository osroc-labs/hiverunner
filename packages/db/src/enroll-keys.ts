import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"
import { organization } from "@workspace/auth/schema"
import type { GitHubApp } from "@workspace/github"

import {
  enrollMachine,
  sha256Hex,
  validateMachineFacts,
  type MachineFacts,
  type Refusal,
} from "@workspace/db/machines"
import { enrollKey } from "@workspace/db/schema"

/** The longest a key lives: long enough for a fleet, not for ever. */
export const ENROLL_KEY_MAX_HOURS = 90 * 24

/** Keys a hive may have live at once. */
export const MAX_ENROLL_KEYS = 50

const HOUR = 3_600_000

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `hwe_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`
}

export type EnrollKeyRow = typeof enrollKey.$inferSelect

/** Whether a key can enroll a machine now, and if not, why not. */
export function keyState(row: EnrollKeyRow, now = new Date()) {
  if (row.revokedAt) return "revoked" as const
  if (row.expiresAt.getTime() <= now.getTime()) return "expired" as const
  if (row.maxUses !== null && row.uses >= row.maxUses) return "used" as const
  return "live" as const
}

const live = (now: Date) =>
  and(
    isNull(enrollKey.revokedAt),
    gt(enrollKey.expiresAt, now),
    or(isNull(enrollKey.maxUses), lt(enrollKey.uses, enrollKey.maxUses))
  )

/**
 * Mints a key that enrolls machines in this hive as `userId`'s. Returns the
 * key, once: only its hash is stored. Whether the person may mint one is the
 * caller's to check.
 */
export async function mintEnrollKey(
  db: AuthDb,
  input: {
    organizationId: string
    userId: string
    description?: string
    expiresInHours: number
    maxUses?: number | null
  },
  now = new Date()
) {
  const fields: Record<string, string> = {}
  if (
    !Number.isInteger(input.expiresInHours) ||
    input.expiresInHours < 1 ||
    input.expiresInHours > ENROLL_KEY_MAX_HOURS
  )
    fields.expiresInHours = `A whole number of hours from 1 to ${ENROLL_KEY_MAX_HOURS}`
  const maxUses = input.maxUses ?? null
  if (
    maxUses !== null &&
    (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
  )
    fields.maxUses = "A whole number from 1 to 1000, or none for no limit"
  const description = (input.description ?? "").trim()
  if (description.length > 100) fields.description = "Up to 100 characters"
  if (Object.keys(fields).length)
    return {
      ok: false as const,
      code: "INVALID_INPUT" as const,
      message: "This key cannot be made",
      fields,
    }
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)` })
    .from(enrollKey)
    .where(
      and(eq(enrollKey.organizationId, input.organizationId), live(now))
    )) as [{ count: number }]
  if (count >= MAX_ENROLL_KEYS)
    return {
      ok: false as const,
      code: "CONFLICT" as const,
      message: `This hive has ${MAX_ENROLL_KEYS} live enroll keys. Revoke one first.`,
    }
  const key = newKey()
  const [row] = await db
    .insert(enrollKey)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      description,
      keyHash: await sha256Hex(key),
      prefix: key.slice(0, 12),
      maxUses,
      expiresAt: new Date(now.getTime() + input.expiresInHours * HOUR),
      createdAt: now,
    })
    .returning()
  return { ok: true as const, key, row: row! }
}

/** A hive's keys, newest first, without their hashes. */
export async function listEnrollKeys(
  db: AuthDb,
  organizationId: string,
  limit = 100
) {
  return db
    .select()
    .from(enrollKey)
    .where(eq(enrollKey.organizationId, organizationId))
    .orderBy(desc(enrollKey.createdAt))
    .limit(limit)
}

/**
 * Revokes one of a hive's keys. Machines it enrolled stay enrolled: each has
 * its own token, and removing them is a separate decision.
 */
export async function revokeEnrollKey(
  db: AuthDb,
  input: { organizationId: string; id: string },
  now = new Date()
) {
  const revoked = await db
    .update(enrollKey)
    .set({ revokedAt: now })
    .where(
      and(
        eq(enrollKey.id, input.id),
        eq(enrollKey.organizationId, input.organizationId),
        isNull(enrollKey.revokedAt)
      )
    )
    .returning({ id: enrollKey.id })
  return revoked.length > 0
}

type GitHubChecks = Pick<GitHubApp, "isTeamMember" | "getOrgRole" | "getLogin">

export type KeyEnrollment =
  | {
      ok: true
      machineId: string
      token: string
      hive: { id: string; name: string }
      userId: string
    }
  | {
      ok: false
      code: Refusal["code"] | "UNAUTHENTICATED"
      message: string
      fields?: Record<string, string>
    }

/**
 * Enrolls a machine with a key in place of a person's sign-in. The machine
 * is the minter's, in the key's hive, and authorized there as any machine of
 * theirs would be: someone who has since left the hive mints nothing more.
 *
 * `hives`, if given, must name the key's hive, by id or as GitHub names it,
 * so a key used for the wrong hive says so instead of enrolling somewhere
 * the person did not mean.
 */
export async function enrollWithKey(
  db: AuthDb,
  github: GitHubChecks | null,
  input: { key: string; hives?: string[]; facts: MachineFacts },
  now = new Date()
): Promise<KeyEnrollment> {
  const fields = validateMachineFacts(input.facts)
  if (fields)
    return {
      ok: false as const,
      code: "INVALID_INPUT" as const,
      message: "This machine cannot be enrolled",
      fields,
    }
  const [row] = await db
    .select({ key: enrollKey, hive: organization.name })
    .from(enrollKey)
    .innerJoin(organization, eq(organization.id, enrollKey.organizationId))
    .where(eq(enrollKey.keyHash, await sha256Hex(input.key)))
    .limit(1)
  const refused = (message: string) => ({
    ok: false as const,
    code: "UNAUTHENTICATED" as const,
    message,
  })
  if (!row) return refused("That enroll key is not one Hive Runner knows.")
  const state = keyState(row.key, now)
  if (state === "revoked") return refused("That enroll key was revoked.")
  if (state === "expired") return refused("That enroll key has expired.")
  if (state === "used")
    return refused("That enroll key has enrolled all the machines it allows.")
  const wanted = (input.hives ?? []).filter(
    (hive) => hive.toLowerCase() !== "all"
  )
  const elsewhere = wanted.find(
    (hive) =>
      hive !== row.key.organizationId &&
      hive.trim().toLowerCase() !== row.hive.toLowerCase()
  )
  if (elsewhere !== undefined)
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: `That enroll key adds machines to ${row.hive}, not ${JSON.stringify(elsewhere)}.`,
    }

  // Taken before the machine is made, so two machines racing for a key's
  // last use cannot both have it; given back if enrolling fails.
  const [taken] = await db
    .update(enrollKey)
    .set({ uses: sql`${enrollKey.uses} + 1`, lastUsedAt: now })
    .where(and(eq(enrollKey.id, row.key.id), live(now)))
    .returning({ id: enrollKey.id })
  if (!taken)
    return refused("That enroll key has enrolled all the machines it allows.")
  const result = await enrollMachine(
    db,
    github,
    {
      userId: row.key.userId,
      organizationIds: [row.key.organizationId],
      facts: input.facts,
    },
    now
  )
  if (!result.ok) {
    await db
      .update(enrollKey)
      .set({ uses: sql`${enrollKey.uses} - 1` })
      .where(eq(enrollKey.id, row.key.id))
    return result
  }
  return {
    ok: true,
    machineId: result.machineId,
    token: result.token,
    hive: { id: row.key.organizationId, name: row.hive },
    userId: row.key.userId,
  }
}
