import { and, desc, eq, sql } from "drizzle-orm"

import type { AuthDb } from "@workspace/auth/db"
import { member, session, user } from "@workspace/auth/schema"
import type { GitHubApp } from "@workspace/github"

import { canAddMachines } from "@workspace/db/membership"
import { githubInstallation, machine } from "@workspace/db/schema"

/** Enough for a laptop, a desktop and a few build boxes; not for abuse. */
export const MAX_MACHINES_PER_PERSON = 10

export type MachineFacts = {
  name: string
  model: string
  os: string
  arch: string
  cores: number
  memoryBytes: number
  daemonVersion: string
  /** The daemon's own benchmark. A claim, clamped here, corrected later. */
  speedScore?: number
}

export type EnrollResult =
  | { ok: true; machineId: string; token: string }
  | {
      ok: false
      code: "INVALID_INPUT" | "FORBIDDEN" | "CONFLICT"
      message: string
      fields?: Record<string, string>
    }

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `hwm_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max

export function validateMachineFacts(facts: MachineFacts) {
  const fields: Record<string, string> = {}
  if (!text(facts.name, 80)) fields.name = "Give the machine a name"
  if (!text(facts.model, 120)) fields.model = "Missing hardware model"
  if (!text(facts.daemonVersion, 40))
    fields.daemonVersion = "Missing daemon version"
  // v1 hosts. Widening this is a product decision, not a validation tweak.
  if (facts.os !== "darwin" || facts.arch !== "arm64")
    fields.os = "HiveWorker runs on Apple Silicon Macs for now"
  if (!Number.isInteger(facts.cores) || facts.cores < 1 || facts.cores > 512)
    fields.cores = "Invalid core count"
  if (!Number.isSafeInteger(facts.memoryBytes) || facts.memoryBytes < 2 ** 30)
    fields.memoryBytes = "Invalid memory size"
  if (
    facts.speedScore !== undefined &&
    !(Number.isFinite(facts.speedScore) && facts.speedScore > 0)
  )
    fields.speedScore = "Invalid benchmark result"
  return Object.keys(fields).length ? fields : null
}

/**
 * Adds a machine to a pool and returns its token, once. The token is not
 * stored and cannot be shown again; a lost one means enrolling again.
 *
 * `github` is null only where no GitHub App is configured (local
 * development), in which case cached membership is all there is to check.
 */
export async function enrollMachine(
  db: AuthDb,
  github: Pick<GitHubApp, "isTeamMember" | "getOrgRole" | "getLogin"> | null,
  input: { userId: string; organizationId: string; facts: MachineFacts },
  now = new Date()
): Promise<EnrollResult> {
  const fields = validateMachineFacts(input.facts)
  if (fields)
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "This machine cannot be enrolled",
      fields,
    }

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId)
      )
    )
    .limit(1)
  const allowed =
    membership &&
    (github
      ? await canAddMachines(db, github, input)
      : await poolIsActive(db, input.organizationId))
  if (!allowed)
    return {
      ok: false,
      code: "FORBIDDEN",
      message:
        "You cannot add machines to this pool. Ask an owner whether it is limited to certain teams.",
    }

  const [count] = await db
    .select({ n: sql<number>`count(*)`.as("n") })
    .from(machine)
    .where(
      and(
        eq(machine.organizationId, input.organizationId),
        eq(machine.userId, input.userId),
        eq(machine.status, "active")
      )
    )
  if (Number(count?.n ?? 0) >= MAX_MACHINES_PER_PERSON)
    return {
      ok: false,
      code: "CONFLICT",
      message: `You already have ${MAX_MACHINES_PER_PERSON} machines in this pool. Remove one first.`,
    }

  const token = newToken()
  const machineId = crypto.randomUUID()
  await db.insert(machine).values({
    id: machineId,
    organizationId: input.organizationId,
    userId: input.userId,
    name: input.facts.name.trim(),
    model: input.facts.model.trim(),
    os: input.facts.os,
    arch: input.facts.arch,
    cores: input.facts.cores,
    memoryBytes: input.facts.memoryBytes,
    speedScore: Math.min(Math.max(input.facts.speedScore ?? 1, 0.25), 8),
    daemonVersion: input.facts.daemonVersion.trim(),
    tokenHash: await sha256Hex(token),
    createdAt: now,
  })
  return { ok: true, machineId, token }
}

async function poolIsActive(db: AuthDb, organizationId: string) {
  const [row] = await db
    .select({ status: githubInstallation.status })
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, organizationId))
    .limit(1)
  return row?.status === "active"
}

export async function listMachines(db: AuthDb, organizationId: string) {
  return db
    .select({
      id: machine.id,
      name: machine.name,
      model: machine.model,
      cores: machine.cores,
      memoryBytes: machine.memoryBytes,
      speedScore: machine.speedScore,
      status: machine.status,
      presence: machine.presence,
      lastSeenAt: machine.lastSeenAt,
      createdAt: machine.createdAt,
      userId: machine.userId,
      owner: user.name,
    })
    .from(machine)
    .innerJoin(user, eq(user.id, machine.userId))
    .where(
      and(
        eq(machine.organizationId, organizationId),
        eq(machine.status, "active")
      )
    )
    .orderBy(desc(machine.createdAt))
    .limit(500)
}

export async function getMachine(db: AuthDb, machineId: string) {
  const [row] = await db
    .select()
    .from(machine)
    .where(eq(machine.id, machineId))
    .limit(1)
  return row ?? null
}

export async function revokeMachine(
  db: AuthDb,
  machineId: string,
  now = new Date()
) {
  await db
    .update(machine)
    .set({ status: "revoked", revokedAt: now })
    .where(and(eq(machine.id, machineId), eq(machine.status, "active")))
}

/**
 * Who a machine token belongs to, for the tunnel. Null unless the machine is
 * active and its pool's installation is too.
 */
export async function authenticateMachine(db: AuthDb, token: string) {
  if (!token.startsWith("hwm_")) return null
  const [row] = await db
    .select({ machine, installation: githubInstallation.status })
    .from(machine)
    .innerJoin(
      githubInstallation,
      eq(githubInstallation.organizationId, machine.organizationId)
    )
    .where(eq(machine.tokenHash, await sha256Hex(token)))
    .limit(1)
  if (!row || row.machine.status !== "active" || row.installation !== "active")
    return null
  return row.machine
}

/** The daemon's sign-in session has done its one job. */
export async function endSession(db: AuthDb, sessionId: string) {
  await db.delete(session).where(eq(session.id, sessionId))
}
