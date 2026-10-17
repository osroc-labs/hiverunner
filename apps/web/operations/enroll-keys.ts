import {
  ENROLL_KEY_MAX_HOURS,
  keyState,
  listEnrollKeys as readEnrollKeys,
  mintEnrollKey,
  revokeEnrollKey as dropEnrollKey,
  type EnrollKeyRow,
} from "@workspace/db/enroll-keys"
import { getOrganization } from "@workspace/auth"

import { INSTALL_SCRIPT_URL } from "@/components/marketing/site"
import { AppError } from "@/lib/errors"
import { authorize, type OperationContext } from "./context"

/**
 * Enroll keys: how machines join a hive with nobody at a browser. Minting,
 * listing and revoking one is for the hive's owners and admins, from MCP or
 * the API alike.
 */

const keyShape = (row: EnrollKeyRow, now = new Date()) => ({
  id: row.id,
  prefix: row.prefix,
  description: row.description,
  state: keyState(row, now),
  uses: row.uses,
  maxUses: row.maxUses,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  mintedBy: row.userId,
})

/** Mints a key, and returns it with the commands that use it. Shown once. */
export async function createEnrollKey(
  context: OperationContext,
  input: {
    description?: string
    expiresInHours?: number
    maxUses?: number | null
  }
) {
  await authorize(context, "hive:write", "admin")
  const { organizationId, userId } = context.actor
  const minted = await mintEnrollKey(context.db, {
    organizationId,
    userId,
    description: input.description,
    expiresInHours: input.expiresInHours ?? 24,
    maxUses: input.maxUses,
  })
  if (!minted.ok) throw new AppError(minted.code, minted.message, minted.fields)
  const hive = (await getOrganization(context.db, organizationId))?.name ?? ""
  return {
    key: minted.key,
    enrollKey: keyShape(minted.row),
    note: "This is the only time the key is shown. Machines it enrolls are yours, as if you had signed in on each.",
    commands: {
      install: `curl -fsSL ${INSTALL_SCRIPT_URL} | HIVE_ENROLL_KEY=${minted.key} sh -s -- --hive ${hive}`,
      login: `HIVE_ENROLL_KEY=${minted.key} hived login --hive ${hive}`,
    },
  }
}

/** The hive's keys, newest first. Never the keys themselves. */
export async function listEnrollKeys(context: OperationContext) {
  await authorize(context, "hive:read", "admin")
  const now = new Date()
  const rows = await readEnrollKeys(context.db, context.actor.organizationId)
  return {
    enrollKeys: rows.map((row) => keyShape(row, now)),
    maxHours: ENROLL_KEY_MAX_HOURS,
  }
}

/** Revokes a key. What it enrolled stays enrolled. */
export async function revokeEnrollKey(
  context: OperationContext,
  input: { id: string }
) {
  await authorize(context, "hive:write", "admin")
  if (typeof input.id !== "string" || !input.id)
    throw new AppError("INVALID_INPUT", "Say which key")
  if (
    !(await dropEnrollKey(context.db, {
      organizationId: context.actor.organizationId,
      id: input.id,
    }))
  )
    throw new AppError(
      "NOT_FOUND",
      "No such enroll key, or it is revoked already"
    )
  return { revoked: true, id: input.id }
}
