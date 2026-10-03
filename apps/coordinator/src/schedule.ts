import type { Presence } from "@workspace/protocol"

export type Candidate = {
  machineId: string
  presence: Presence
  cores: number
  speedScore: number
  /** Set while a job is assigned and not yet finished. */
  assignmentId?: string
}

/**
 * The machine a job of this size should go to, or null if none can take it.
 *
 * Among machines that can, the fastest: the job finishes sooner, and the
 * speed score already prices the difference. A machine is offered a job only
 * if it would still have cores left for its owner.
 */
export function pickMachine(candidates: Candidate[], vcpus: number) {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.presence !== "online" || candidate.assignmentId) continue
    if (candidate.cores - vcpus < 2) continue
    if (!best || candidate.speedScore > best.speedScore) best = candidate
  }
  return best
}
