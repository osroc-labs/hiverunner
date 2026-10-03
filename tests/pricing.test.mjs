import assert from "node:assert/strict"
import { test } from "node:test"
import {
  FLOOR_RATE,
  computeUnits,
  priceJob,
  privatePoolUsdPerMinute,
  usdToMicroTokens,
  microTokensToUsd,
} from "../packages/pricing/src/index.ts"

test("minutes are billed whole and never below one", () => {
  assert.equal(computeUnits({ seconds: 0, vcpus: 2, speedScore: 1 }), 2)
  assert.equal(computeUnits({ seconds: 60, vcpus: 2, speedScore: 1 }), 2)
  assert.equal(computeUnits({ seconds: 61, vcpus: 2, speedScore: 1 }), 4)
  assert.equal(computeUnits({ seconds: 600, vcpus: 8, speedScore: 1.5 }), 120)
})
test("a job's tax and earning sum to the charge exactly", () => {
  for (const seconds of [1, 59, 61, 3599, 86400])
    for (const speedScore of [0.7, 1, 1.37, 2.4]) {
      const job = priceJob({ seconds, vcpus: 4, speedScore })
      assert.ok(Number.isInteger(job.amount) && Number.isInteger(job.tax))
      assert.equal(job.tax + job.earning, job.amount)
    }
})
test("rates below the floor are refused", () => {
  assert.throws(() =>
    priceJob({ seconds: 60, vcpus: 2, speedScore: 1, rate: FLOOR_RATE - 1 })
  )
})
test("the placeholders give the documented private pool cost", () => {
  const { gross, net } = privatePoolUsdPerMinute(2)
  assert.equal(gross, 0.001)
  assert.equal(net, 0.00025)
  const job = priceJob({ seconds: 60, vcpus: 2, speedScore: 1 })
  assert.equal(microTokensToUsd(job.amount), 0.001)
  assert.equal(usdToMicroTokens(5), 5_000_000)
})
