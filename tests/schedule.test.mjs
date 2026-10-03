import assert from "node:assert/strict"
import { test } from "node:test"
import { pickMachine } from "../apps/coordinator/src/schedule.ts"

const machine = (machineId, extra = {}) => ({
  machineId,
  presence: "online",
  cores: 12,
  speedScore: 1,
  ...extra,
})

test("only free, online machines are offered jobs", () => {
  assert.equal(pickMachine([], 2), null)
  for (const presence of ["offline", "paused", "busy", "draining"])
    assert.equal(pickMachine([machine("a", { presence })], 2), null, presence)
  assert.equal(pickMachine([machine("a", { assignmentId: "x" })], 2), null)
  assert.equal(pickMachine([machine("a")], 2).machineId, "a")
})

test("the fastest machine that fits wins", () => {
  const pool = [
    machine("slow", { speedScore: 0.9 }),
    machine("fast", { speedScore: 2.1 }),
    machine("fastest-but-busy", { speedScore: 3, presence: "busy" }),
  ]
  assert.equal(pickMachine(pool, 2).machineId, "fast")
})

test("a job never takes a machine's last cores from its owner", () => {
  assert.equal(pickMachine([machine("air", { cores: 8 })], 8), null)
  assert.equal(pickMachine([machine("air", { cores: 8 })], 4).machineId, "air")
  assert.equal(
    pickMachine([machine("studio", { cores: 24 })], 8).machineId,
    "studio"
  )
})
