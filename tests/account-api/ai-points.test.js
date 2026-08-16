import { describe, expect, it } from 'vitest'

import {
  adjustAiPoints,
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
  getAiPointAccount,
  grantAiPoints,
  listAiPointTransactions,
  refundAiPoints,
  releaseAiPoints,
  reserveAiPoints,
  settleAiPoints,
} from '../../cloudfunctions/account-api/ai-points.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-14T09:00:00+08:00')

function grantInput(extra = {}) {
  return {
    userId: 'user_fixture_001',
    appId: 'advjs-studio',
    scope: 'studio-managed-ai',
    amountMicroPoints: 100_000,
    idempotencyKey: 'beta-grant:user_fixture_001:v1',
    actor: 'admin',
    operator: 'owner_fixture',
    reason: 'ADV.JS managed AI beta grant',
    meta: { campaign: 'advjs-beta-v1' },
    now: NOW,
    ...extra,
  }
}

describe('account-api ai point ledger', () => {
  it('grants beta points once and appends one immutable transaction', async () => {
    const db = makeFakeDb({})

    const first = await grantAiPoints(db, grantInput())
    const replay = await grantAiPoints(db, grantInput({ now: NOW + 1 }))

    expect(first).toMatchObject({
      deduped: false,
      account: {
        userId: 'user_fixture_001',
        access: 'beta',
        availableMicroPoints: 100_000,
        reservedMicroPoints: 0,
        lifetimeGrantedMicroPoints: 100_000,
        lifetimeChargedMicroPoints: 0,
        version: 1,
      },
    })
    expect(replay).toMatchObject({
      deduped: true,
      account: {
        availableMicroPoints: 100_000,
        version: 1,
      },
    })
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION]).toHaveLength(1)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toEqual([
      expect.objectContaining({
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        type: 'beta_grant',
        availableDelta: 100_000,
        reservedDelta: 0,
        chargedMicroPoints: 0,
        availableAfter: 100_000,
        reservedAfter: 0,
        idempotencyKey: 'beta-grant:user_fixture_001:v1',
        actor: 'admin',
        operator: 'owner_fixture',
        reason: 'ADV.JS managed AI beta grant',
        meta: { campaign: 'advjs-beta-v1' },
        createdAt: NOW,
      }),
    ])
  })

  it('reserves one task atomically and replays without increasing limits', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    const input = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    }

    const first = await reserveAiPoints(db, input)
    const replay = await reserveAiPoints(db, {
      ...input,
      activeTaskExpiresAt: NOW + 11 * 60 * 1000,
      now: NOW + 2,
    })

    expect(first).toMatchObject({
      deduped: false,
      account: {
        availableMicroPoints: 70_000,
        reservedMicroPoints: 30_000,
        activeTask: {
          taskId: 'task_fixture_001',
          reservedMicroPoints: 30_000,
          expiresAt: NOW + 10 * 60 * 1000,
        },
        daily: {
          dateKey: '2026-08-14',
          acceptedTasks: 1,
          reservedMicroPoints: 30_000,
          chargedMicroPoints: 0,
        },
        version: 2,
      },
    })
    expect(replay).toMatchObject({
      deduped: true,
      account: {
        availableMicroPoints: 70_000,
        reservedMicroPoints: 30_000,
        activeTask: { expiresAt: NOW + 10 * 60 * 1000 },
        daily: { acceptedTasks: 1 },
        version: 2,
      },
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(2)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION][1]).toMatchObject({
      type: 'reserve',
      taskId: 'task_fixture_001',
      availableDelta: -30_000,
      reservedDelta: 30_000,
      availableAfter: 70_000,
      reservedAfter: 30_000,
      idempotencyKey: 'reserve:task_fixture_001',
    })
  })

  it('replays the immutable original result after later account mutations', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    const reserveInput = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_replay_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_replay_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    }
    const first = await reserveAiPoints(db, reserveInput)
    await settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_replay_001',
      chargedMicroPoints: 12_000,
      idempotencyKey: 'settle:task_fixture_replay_001',
      now: NOW + 2,
    })

    const replay = await reserveAiPoints(db, { ...reserveInput, now: NOW + 3 })

    expect(replay).toEqual({ ...first, deduped: true })
    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      availableMicroPoints: 88_000,
      reservedMicroPoints: 0,
      version: 3,
    })
  })

  it('rejects an insufficient task reservation without changing the account or ledger', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())

    await expect(reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_insufficient_001',
      amountMicroPoints: 100_001,
      idempotencyKey: 'reserve:task_fixture_insufficient_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })).rejects.toThrow(/AI 点数余额不足/)

    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      availableMicroPoints: 100_000,
      reservedMicroPoints: 0,
      daily: {
        acceptedTasks: 0,
        chargedMicroPoints: 0,
        reservedMicroPoints: 0,
      },
      version: 1,
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(1)
  })

  it('settles actual usage and releases the unused reservation once', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })
    const input = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_001',
      chargedMicroPoints: 12_000,
      idempotencyKey: 'settle:task_fixture_001',
      now: NOW + 2,
    }

    const first = await settleAiPoints(db, input)
    const replay = await settleAiPoints(db, { ...input, now: NOW + 3 })

    expect(first).toMatchObject({
      deduped: false,
      account: {
        availableMicroPoints: 88_000,
        reservedMicroPoints: 0,
        lifetimeGrantedMicroPoints: 100_000,
        lifetimeChargedMicroPoints: 12_000,
        daily: {
          acceptedTasks: 1,
          reservedMicroPoints: 0,
          chargedMicroPoints: 12_000,
        },
        version: 3,
      },
    })
    expect(first.account).not.toHaveProperty('activeTask')
    expect(replay).toMatchObject({ deduped: true, account: { version: 3 } })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(3)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION][2]).toMatchObject({
      type: 'settle',
      taskId: 'task_fixture_001',
      availableDelta: 18_000,
      reservedDelta: -30_000,
      chargedMicroPoints: 12_000,
      availableAfter: 88_000,
      reservedAfter: 0,
    })
  })

  it('releases a failed task reservation without charging the user', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_failed_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_failed_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })
    const input = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_failed_001',
      idempotencyKey: 'release:task_fixture_failed_001',
      reason: 'parse_error_without_candidate',
      now: NOW + 2,
    }

    const first = await releaseAiPoints(db, input)
    const replay = await releaseAiPoints(db, { ...input, now: NOW + 3 })

    expect(first).toMatchObject({
      deduped: false,
      account: {
        availableMicroPoints: 100_000,
        reservedMicroPoints: 0,
        lifetimeChargedMicroPoints: 0,
        daily: {
          acceptedTasks: 1,
          reservedMicroPoints: 0,
          chargedMicroPoints: 0,
        },
      },
    })
    expect(first.account).not.toHaveProperty('activeTask')
    expect(replay.deduped).toBe(true)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION][2]).toMatchObject({
      type: 'release',
      taskId: 'task_fixture_failed_001',
      availableDelta: 30_000,
      reservedDelta: -30_000,
      chargedMicroPoints: 0,
      reason: 'parse_error_without_candidate',
    })
  })

  it('refunds no more than the task settled charge and remains idempotent', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_refund_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_refund_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })
    await settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_refund_001',
      chargedMicroPoints: 12_000,
      idempotencyKey: 'settle:task_fixture_refund_001',
      now: NOW + 2,
    })
    const input = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_refund_001',
      amountMicroPoints: 5_000,
      idempotencyKey: 'refund:task_fixture_refund_001:1',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'candidate was not delivered',
      meta: { caseId: 'case_fixture_001' },
      now: NOW + 3,
    }

    const first = await refundAiPoints(db, input)
    const replay = await refundAiPoints(db, { ...input, now: NOW + 4 })

    expect(first).toMatchObject({
      deduped: false,
      account: {
        availableMicroPoints: 93_000,
        reservedMicroPoints: 0,
        lifetimeChargedMicroPoints: 7_000,
        daily: { chargedMicroPoints: 7_000 },
        version: 4,
      },
    })
    expect(replay).toMatchObject({ deduped: true, account: { version: 4 } })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION][3]).toMatchObject({
      type: 'refund',
      taskId: 'task_fixture_refund_001',
      availableDelta: 5_000,
      reservedDelta: 0,
      chargedMicroPoints: -5_000,
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'candidate was not delivered',
      meta: { caseId: 'case_fixture_001' },
    })

    await expect(refundAiPoints(db, {
      ...input,
      amountMicroPoints: 8_000,
      idempotencyKey: 'refund:task_fixture_refund_001:2',
    })).rejects.toThrow(/超过任务可退款金额/)
  })

  it('requires a concrete operator for administrator grants and refunds', async () => {
    const db = makeFakeDb({})
    await expect(grantAiPoints(db, grantInput({ operator: undefined })))
      .rejects
      .toThrow(/operator/)

    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_operator_001',
      amountMicroPoints: 10_000,
      idempotencyKey: 'reserve:task_fixture_operator_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })
    await settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_operator_001',
      chargedMicroPoints: 10_000,
      idempotencyKey: 'settle:task_fixture_operator_001',
      now: NOW + 2,
    })

    await expect(refundAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_operator_001',
      amountMicroPoints: 1_000,
      idempotencyKey: 'refund:task_fixture_operator_001',
      actor: 'admin',
      reason: 'operator is required at the ledger boundary',
      now: NOW + 3,
    })).rejects.toThrow(/operator/)
  })

  it('counts every partial refund beyond the CloudBase default query window', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput({ amountMicroPoints: 3_000 }))

    for (const [taskId, chargedMicroPoints] of [
      ['task_fixture_many_refunds', 1_000],
      ['task_fixture_other_charge', 1_000],
    ]) {
      await reserveAiPoints(db, {
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId,
        amountMicroPoints: chargedMicroPoints,
        idempotencyKey: `reserve:${taskId}`,
        activeTaskExpiresAt: NOW + 10 * 60 * 1000,
        now: NOW + 1,
      })
      await settleAiPoints(db, {
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId,
        chargedMicroPoints,
        idempotencyKey: `settle:${taskId}`,
        now: NOW + 2,
      })
    }

    for (let index = 0; index < 100; index += 1) {
      await refundAiPoints(db, {
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId: 'task_fixture_many_refunds',
        amountMicroPoints: 10,
        idempotencyKey: `refund:task_fixture_many_refunds:${index}`,
        actor: 'system',
        reason: 'automated reconciliation fixture',
        now: NOW + 3 + index,
      })
    }

    await expect(refundAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_many_refunds',
      amountMicroPoints: 1,
      idempotencyKey: 'refund:task_fixture_many_refunds:overflow',
      actor: 'system',
      reason: 'must not borrow another task charge',
      now: NOW + 200,
    })).rejects.toThrow(/超过任务可退款金额/)
  })

  it('records signed admin adjustments without rewriting lifetime totals', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    const base = {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'manual beta correction',
      meta: { caseId: 'case_fixture_adjust_001' },
      now: NOW + 1,
    }

    const credit = await adjustAiPoints(db, {
      ...base,
      deltaMicroPoints: 10_000,
      idempotencyKey: 'adjust:user_fixture_001:credit',
    })
    const replay = await adjustAiPoints(db, {
      ...base,
      deltaMicroPoints: 10_000,
      idempotencyKey: 'adjust:user_fixture_001:credit',
      now: NOW + 2,
    })
    const debit = await adjustAiPoints(db, {
      ...base,
      deltaMicroPoints: -20_000,
      idempotencyKey: 'adjust:user_fixture_001:debit',
      now: NOW + 3,
    })

    expect(credit).toMatchObject({ account: { availableMicroPoints: 110_000 }, deduped: false })
    expect(replay).toMatchObject({ deduped: true, account: { availableMicroPoints: 110_000 } })
    expect(debit).toMatchObject({
      account: {
        availableMicroPoints: 90_000,
        lifetimeGrantedMicroPoints: 100_000,
        lifetimeChargedMicroPoints: 0,
        version: 3,
      },
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION].slice(-2)).toEqual([
      expect.objectContaining({ type: 'adjust', availableDelta: 10_000, actor: 'admin', operator: 'owner_fixture' }),
      expect.objectContaining({ type: 'adjust', availableDelta: -20_000, actor: 'admin', operator: 'owner_fixture' }),
    ])

    await expect(adjustAiPoints(db, {
      ...base,
      deltaMicroPoints: -100_000,
      idempotencyKey: 'adjust:user_fixture_001:overdraw',
    })).rejects.toThrow(/可用余额不足/)
  })

  it('reads one account and paginates only that user immutable transactions', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await grantAiPoints(db, grantInput({
      userId: 'user_fixture_002',
      idempotencyKey: 'beta-grant:user_fixture_002:v1',
      now: NOW + 1,
    }))
    await adjustAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      deltaMicroPoints: 10_000,
      idempotencyKey: 'adjust:user_fixture_001:list',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'list fixture',
      now: NOW + 2,
    })

    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      userId: 'user_fixture_001',
      availableMicroPoints: 110_000,
    })
    await expect(getAiPointAccount(db, 'user_missing_001')).resolves.toBeNull()
    const firstPage = await listAiPointTransactions(db, {
      userId: 'user_fixture_001',
      skip: 0,
      limit: 1,
    })
    const secondPage = await listAiPointTransactions(db, {
      userId: 'user_fixture_001',
      skip: firstPage.nextSkip,
      limit: 1,
    })

    expect(firstPage.items).toEqual([
      expect.objectContaining({ type: 'adjust', createdAt: NOW + 2 }),
    ])
    expect(firstPage.items[0]).not.toHaveProperty('resultAccount')
    expect(firstPage.nextSkip).toBe(1)
    expect(secondPage.items).toEqual([
      expect.objectContaining({ type: 'beta_grant', createdAt: NOW }),
    ])
    expect(secondPage.nextSkip).toBe(2)
    expect([...firstPage.items, ...secondPage.items].every(item => item.userId === 'user_fixture_001')).toBe(true)
  })

  it('allows only one concurrent active task', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    const reserve = taskId => reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId,
      amountMicroPoints: 10_000,
      idempotencyKey: `reserve:${taskId}`,
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })

    const outcomes = await Promise.allSettled([
      reserve('task_fixture_concurrent_a'),
      reserve('task_fixture_concurrent_b'),
    ])

    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(item => item.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringMatching(/进行中的 AI 任务/) }) }),
    ])
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(2)
  })

  it('fails closed on idempotency conflicts and settlement overages', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await expect(grantAiPoints(db, grantInput({ amountMicroPoints: 90_000 })))
      .rejects
      .toThrow(/幂等键冲突/)
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_overage_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_overage_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })

    await expect(settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_overage_001',
      chargedMicroPoints: 30_001,
      idempotencyKey: 'settle:task_fixture_overage_001',
      now: NOW + 2,
    })).rejects.toThrow(/超过任务预占/)
    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      availableMicroPoints: 70_000,
      reservedMicroPoints: 30_000,
      activeTask: { taskId: 'task_fixture_overage_001' },
      version: 2,
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(2)
  })

  it('binds settlement and release to the reservation app and scope', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_binding_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_binding_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })

    await expect(settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'another-app',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_binding_001',
      chargedMicroPoints: 10_000,
      idempotencyKey: 'settle:task_fixture_binding_001',
      now: NOW + 2,
    })).rejects.toThrow(/应用或 scope/)
    await expect(releaseAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'another-scope',
      taskId: 'task_fixture_binding_001',
      idempotencyKey: 'release:task_fixture_binding_001',
      reason: 'binding mismatch fixture',
      now: NOW + 3,
    })).rejects.toThrow(/应用或 scope/)

    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      availableMicroPoints: 70_000,
      reservedMicroPoints: 30_000,
      activeTask: { taskId: 'task_fixture_binding_001' },
      version: 2,
    })
  })

  it('enforces twenty accepted tasks per Shanghai calendar day', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    for (let index = 0; index < 20; index += 1) {
      const taskId = `task_fixture_daily_${index}`
      await reserveAiPoints(db, {
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId,
        amountMicroPoints: 1,
        idempotencyKey: `reserve:${taskId}`,
        activeTaskExpiresAt: NOW + 10 * 60 * 1000,
        now: NOW + index * 2 + 1,
      })
      await settleAiPoints(db, {
        userId: 'user_fixture_001',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId,
        chargedMicroPoints: 0,
        idempotencyKey: `settle:${taskId}`,
        now: NOW + index * 2 + 2,
      })
    }

    await expect(reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_daily_21',
      amountMicroPoints: 1,
      idempotencyKey: 'reserve:task_fixture_daily_21',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 100,
    })).rejects.toThrow(/任务数已达上限/)
  })

  it('enforces the daily 500 AI point exposure limit', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput({ amountMicroPoints: 600_000 }))
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_daily_points_001',
      amountMicroPoints: 500_000,
      idempotencyKey: 'reserve:task_fixture_daily_points_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 1,
    })
    await settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_daily_points_001',
      chargedMicroPoints: 500_000,
      idempotencyKey: 'settle:task_fixture_daily_points_001',
      now: NOW + 2,
    })

    await expect(reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_daily_points_002',
      amountMicroPoints: 1,
      idempotencyKey: 'reserve:task_fixture_daily_points_002',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: NOW + 3,
    })).rejects.toThrow(/当日 AI 点数额度不足/)
  })

  it('settles a cross-day task into the new Shanghai day without leaking a reservation', async () => {
    const dayTwo = Date.parse('2026-08-15T00:00:01+08:00')
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput())
    await reserveAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_cross_day_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_cross_day_001',
      activeTaskExpiresAt: dayTwo + 10 * 60 * 1000,
      now: dayTwo - 2_000,
    })
    const settled = await settleAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_cross_day_001',
      chargedMicroPoints: 12_000,
      idempotencyKey: 'settle:task_fixture_cross_day_001',
      now: dayTwo,
    })

    expect(settled.account).toMatchObject({
      reservedMicroPoints: 0,
      daily: {
        dateKey: '2026-08-15',
        acceptedTasks: 0,
        reservedMicroPoints: 0,
        chargedMicroPoints: 12_000,
      },
    })
  })

  it('rolls back when a balance would exceed the safe integer range', async () => {
    const db = makeFakeDb({})
    await grantAiPoints(db, grantInput({ amountMicroPoints: Number.MAX_SAFE_INTEGER }))

    await expect(grantAiPoints(db, grantInput({
      amountMicroPoints: 1,
      idempotencyKey: 'beta-grant:user_fixture_001:overflow',
      now: NOW + 1,
    }))).rejects.toThrow(/安全整数范围/)
    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toMatchObject({
      availableMicroPoints: Number.MAX_SAFE_INTEGER,
      version: 1,
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(1)
  })

  it('rolls back the account write when the immutable transaction write fails', async () => {
    const baseDb = makeFakeDb({})
    const originalRunTransaction = baseDb.runTransaction
    const db = {
      ...baseDb,
      runTransaction(callback) {
        return originalRunTransaction((transaction) => {
          const originalCollection = transaction.collection
          return callback({
            ...transaction,
            collection(name) {
              const collection = originalCollection(name)
              if (name !== AI_POINT_TRANSACTIONS_COLLECTION)
                return collection
              return {
                ...collection,
                doc(id) {
                  const document = collection.doc(id)
                  return {
                    ...document,
                    async set() {
                      throw new Error('injected immutable transaction write failure')
                    },
                  }
                },
              }
            },
          })
        })
      },
    }

    await expect(grantAiPoints(db, grantInput()))
      .rejects
      .toThrow(/injected immutable transaction write failure/)
    await expect(getAiPointAccount(db, 'user_fixture_001')).resolves.toBeNull()
    await expect(listAiPointTransactions(db, {
      userId: 'user_fixture_001',
      limit: 10,
    })).resolves.toEqual({ items: [], nextSkip: null })
  })
})
