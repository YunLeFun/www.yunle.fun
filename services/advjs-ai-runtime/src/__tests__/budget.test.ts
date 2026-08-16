import type { Clock } from '../dependencies.js'
import { describe, expect, it } from 'vitest'
import {
  assertRuntimePolicyAllows,
  createDefaultRuntimePolicy,
  PlatformBudgetService,
} from '../domain/budget.js'
import { createBetaPricingSnapshot } from '../domain/pricing.js'
import { InMemoryRuntimeControlRepository } from '../repositories/in-memory.js'

const DAILY_CAP_MICRO_CNY = 50_000_000

function createMutableClock(initial: number) {
  let now = initial
  const clock: Clock = { now: () => now }
  return {
    clock,
    set(value: number) {
      now = value
    },
  }
}

describe('platform daily budget', () => {
  it('atomically permits only reservations that fit under the daily cap', async () => {
    const repository = new InMemoryRuntimeControlRepository()
    const service = new PlatformBudgetService(repository, { now: () => Date.UTC(2026, 7, 14) })

    const results = await Promise.allSettled([
      service.reserve({
        capMicroCny: DAILY_CAP_MICRO_CNY,
        idempotencyKey: 'reserve_task_fixture_001',
        maxAutomaticAttempts: 3,
        singleAttemptMaxMicroCny: 10_000_000,
        taskId: 'task_fixture_001',
      }),
      service.reserve({
        capMicroCny: DAILY_CAP_MICRO_CNY,
        idempotencyKey: 'reserve_task_fixture_002',
        maxAutomaticAttempts: 3,
        singleAttemptMaxMicroCny: 10_000_000,
        taskId: 'task_fixture_002',
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(service.getBudget('2026-08-14')).resolves.toMatchObject({
      actualProviderCostMicroCny: 0,
      reservedProviderCostMicroCny: 30_000_000,
    })
  })

  it('settles and releases reservations idempotently without guessing cost', async () => {
    const repository = new InMemoryRuntimeControlRepository()
    const service = new PlatformBudgetService(repository, { now: () => Date.UTC(2026, 7, 14) })
    const reservation = await service.reserve({
      capMicroCny: DAILY_CAP_MICRO_CNY,
      idempotencyKey: 'reserve_task_fixture_001',
      maxAutomaticAttempts: 2,
      singleAttemptMaxMicroCny: 10_000_000,
      taskId: 'task_fixture_001',
    })

    const settlement = {
      actualProviderCostMicroCny: 12_000_000,
      dateKey: reservation.dateKey,
      idempotencyKey: 'settle_task_fixture_001',
      taskId: 'task_fixture_001',
    }
    await service.settle(settlement)
    await service.settle(settlement)

    await expect(service.getBudget(reservation.dateKey)).resolves.toMatchObject({
      actualProviderCostMicroCny: 12_000_000,
      reservedProviderCostMicroCny: 0,
    })
    await expect(service.settle({ ...settlement, actualProviderCostMicroCny: 11_000_000 })).rejects.toThrowError(/idempotency/i)

    const released = await service.reserve({
      capMicroCny: DAILY_CAP_MICRO_CNY,
      idempotencyKey: 'reserve_task_fixture_002',
      maxAutomaticAttempts: 1,
      singleAttemptMaxMicroCny: 5_000_000,
      taskId: 'task_fixture_002',
    })
    await service.release({
      dateKey: released.dateKey,
      idempotencyKey: 'release_task_fixture_002',
      taskId: 'task_fixture_002',
    })
    await expect(service.getBudget(released.dateKey)).resolves.toMatchObject({
      actualProviderCostMicroCny: 12_000_000,
      reservedProviderCostMicroCny: 0,
    })
  })

  it('uses Asia/Shanghai date buckets and hard-stops after actual cost reaches the cap', async () => {
    const time = createMutableClock(Date.UTC(2026, 7, 14, 15, 59, 59))
    const repository = new InMemoryRuntimeControlRepository()
    const service = new PlatformBudgetService(repository, time.clock)
    const first = await service.reserve({
      capMicroCny: DAILY_CAP_MICRO_CNY,
      idempotencyKey: 'reserve_task_fixture_001',
      maxAutomaticAttempts: 1,
      singleAttemptMaxMicroCny: DAILY_CAP_MICRO_CNY,
      taskId: 'task_fixture_001',
    })
    await service.settle({
      actualProviderCostMicroCny: DAILY_CAP_MICRO_CNY,
      dateKey: first.dateKey,
      idempotencyKey: 'settle_task_fixture_001',
      taskId: 'task_fixture_001',
    })
    await expect(service.reserve({
      capMicroCny: DAILY_CAP_MICRO_CNY,
      idempotencyKey: 'reserve_task_fixture_002',
      maxAutomaticAttempts: 1,
      singleAttemptMaxMicroCny: 1,
      taskId: 'task_fixture_002',
    })).rejects.toThrowError(/daily provider budget/i)

    time.set(Date.UTC(2026, 7, 14, 16, 0, 1))
    await expect(service.reserve({
      capMicroCny: DAILY_CAP_MICRO_CNY,
      idempotencyKey: 'reserve_task_fixture_003',
      maxAutomaticAttempts: 1,
      singleAttemptMaxMicroCny: 1,
      taskId: 'task_fixture_003',
    })).resolves.toMatchObject({ dateKey: '2026-08-15' })
  })

  it('enforces the kill switch, model switch and capability switch from server policy', () => {
    const policy = createDefaultRuntimePolicy({
      model: 'deepseek-v3.2',
      pricing: createBetaPricingSnapshot({
        version: 'pricing_fixture_v1',
        billingUnit: 1_000_000,
        inputMicroCnyPerUnit: 1,
        outputMicroCnyPerUnit: 1,
      }),
      version: 'policy_fixture_v1',
    })

    expect(policy).toMatchObject({
      enabled: false,
      modelEnabled: false,
      capabilities: {
        'generate-outline': false,
        'generate-chapter-draft': false,
        'suggest-plot': false,
        'simulate-roleplay': false,
        'check-consistency': false,
      },
    })
    expect(() => assertRuntimePolicyAllows(policy, 'generate-outline')).toThrowError(/disabled/i)
    const enabled = {
      ...policy,
      enabled: true,
      modelEnabled: true,
      capabilities: { ...policy.capabilities, 'generate-outline': true },
    }
    expect(() => assertRuntimePolicyAllows(enabled, 'generate-outline')).not.toThrow()
    expect(() => assertRuntimePolicyAllows({ ...enabled, modelEnabled: false }, 'generate-outline')).toThrowError(/model.*disabled/i)
    expect(() => assertRuntimePolicyAllows({
      ...enabled,
      capabilities: { ...enabled.capabilities, 'generate-outline': false },
    }, 'generate-outline')).toThrowError(/capability.*disabled/i)
  })
})
