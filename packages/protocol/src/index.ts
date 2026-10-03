/**
 * The tunnel between a daemon and the coordinator: JSON text frames over one
 * outbound WebSocket.
 *
 * The Go daemon has its own copy of these shapes in `daemon/internal/protocol`.
 * `fixtures/*.json` is the contract between the two: both sides' tests must
 * decode every message in it, so a change here that Go cannot read fails Go's
 * tests, and the other way round.
 */

/** Bumped on any change an older peer could not safely ignore. */
export const PROTOCOL_VERSION = 1

/** Sent and answered without waking the coordinator's object. */
export const PING = "ping"
export const PONG = "pong"

export const PRESENCE = [
  "offline",
  "paused",
  "online",
  "busy",
  "draining",
] as const
export type Presence = (typeof PRESENCE)[number]

/** Close codes the daemon acts on. 4000-4999 is the application range. */
export const CLOSE = {
  /** Another connection for the same machine took over. Do not reconnect. */
  REPLACED: 4000,
  /** The machine token is no longer valid. Do not reconnect; enroll again. */
  REVOKED: 4001,
  /** The daemon is too old to speak to this coordinator. */
  UNSUPPORTED: 4002,
} as const

export type DaemonMessage =
  | {
      type: "hello"
      protocol: number
      daemonVersion: string
      presence: Presence
    }
  | { type: "presence"; presence: Presence }
  | { type: "job.accepted"; assignmentId: string }
  | { type: "job.rejected"; assignmentId: string; reason: string }
  | { type: "job.exited"; assignmentId: string; exitCode: number }

export type CoordinatorMessage =
  | { type: "welcome"; machineId: string; protocol: number }
  | {
      type: "job.assign"
      assignmentId: string
      /** The `runs-on` label, which is also the scale set. */
      label: string
      vcpus: number
      /** GitHub's one-time runner configuration, passed to the runner as is. */
      jitConfig: string
      timeoutMinutes: number
    }
  | { type: "drain" }
  | { type: "error"; message: string }

const MAX_FRAME = 64 * 1024

const isString = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max

const isPresence = (value: unknown): value is Presence =>
  PRESENCE.includes(value as Presence)

/**
 * A frame from a daemon, or null if it is not one. Daemons run on machines
 * we do not control, so nothing about a frame is assumed.
 */
export function parseDaemonMessage(raw: string): DaemonMessage | null {
  if (raw.length > MAX_FRAME) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  switch (value.type) {
    case "hello":
      return Number.isInteger(value.protocol) &&
        isString(value.daemonVersion, 40) &&
        isPresence(value.presence)
        ? {
            type: "hello",
            protocol: value.protocol as number,
            daemonVersion: value.daemonVersion,
            presence: value.presence,
          }
        : null
    case "presence":
      return isPresence(value.presence)
        ? { type: "presence", presence: value.presence }
        : null
    case "job.accepted":
      return isString(value.assignmentId)
        ? { type: "job.accepted", assignmentId: value.assignmentId }
        : null
    case "job.rejected":
      return isString(value.assignmentId) && isString(value.reason, 500)
        ? {
            type: "job.rejected",
            assignmentId: value.assignmentId,
            reason: value.reason,
          }
        : null
    case "job.exited":
      return isString(value.assignmentId) && Number.isInteger(value.exitCode)
        ? {
            type: "job.exited",
            assignmentId: value.assignmentId,
            exitCode: value.exitCode as number,
          }
        : null
    default:
      return null
  }
}
