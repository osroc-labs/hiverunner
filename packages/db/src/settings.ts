import { and, eq } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"

import { poolSettings } from "@workspace/db/schema"

export type PoolSettingsInput = {
  allowedTeams: string[]
  earningsDestination: "organization" | "developer"
  /** The version the editor loaded; a stale one is refused. */
  version: number
}

const TEAM_SLUG = /^[a-z0-9][a-z0-9._-]{0,99}$/

/** Returns field errors, or null when the input is usable. */
export function validatePoolSettings(input: PoolSettingsInput) {
  const fields: Record<string, string> = {}
  if (
    input.allowedTeams.length > 20 ||
    input.allowedTeams.some((slug) => !TEAM_SLUG.test(slug)) ||
    new Set(input.allowedTeams).size !== input.allowedTeams.length
  )
    fields.allowedTeams =
      "Use up to 20 distinct team slugs, as they appear in the team's GitHub URL"
  if (!["organization", "developer"].includes(input.earningsDestination))
    fields.earningsDestination = "Choose who is paid"
  if (!Number.isInteger(input.version)) fields.version = "Reload and try again"
  return Object.keys(fields).length ? fields : null
}

export async function getPoolSettings(db: AuthDb, organizationId: string) {
  const [row] = await db
    .select()
    .from(poolSettings)
    .where(eq(poolSettings.organizationId, organizationId))
    .limit(1)
  return row ?? null
}

/** False when someone else saved first. */
export async function updatePoolSettings(
  db: AuthDb,
  organizationId: string,
  input: PoolSettingsInput,
  now = new Date()
) {
  const updated = await db
    .update(poolSettings)
    .set({
      allowedTeams: input.allowedTeams,
      earningsDestination: input.earningsDestination,
      version: input.version + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(poolSettings.organizationId, organizationId),
        eq(poolSettings.version, input.version)
      )
    )
    .returning({ version: poolSettings.version })
  return updated.length > 0
}
