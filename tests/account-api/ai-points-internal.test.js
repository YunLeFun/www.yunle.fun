import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { AI_POINT_TRANSACTIONS_COLLECTION } from '../../cloudfunctions/account-api/ai-points.js'
import {
  handleGetAiPointAccountForUser,
  handleGrantAiPointsForUser,
  handleListAiPointTransactionsForUser,
  handleReserveAiPointsForTask,
  handleSettleAiPointsForTask,
} from '../../cloudfunctions/account-api/internal.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-14T09:00:00+08:00')
const TOKEN = 'ai-runtime-account-api-token'

describe('account-api internal ai point actions', () => {
  it('requires the private service token before any ledger access', async () => {
    const db = makeFakeDb({})

    await expect(handleGetAiPointAccountForUser(db, {
      serviceToken: 'wrong',
      userId: 'user_fixture_001',
    }, { expectedToken: TOKEN })).rejects.toThrow(/内部服务鉴权失败/)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION] ?? []).toHaveLength(0)
  })

  it('does not accept the generic account-api token as the AI ledger credential', async () => {
    const previousGeneric = process.env.ACCOUNT_API_INTERNAL_TOKEN
    const previousAi = process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN
    process.env.ACCOUNT_API_INTERNAL_TOKEN = TOKEN
    delete process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN
    try {
      await expect(handleGetAiPointAccountForUser(makeFakeDb({}), {
        serviceToken: TOKEN,
        userId: 'user_fixture_001',
      })).rejects.toThrow(/内部服务鉴权未配置/)
    }
    finally {
      if (previousGeneric === undefined)
        delete process.env.ACCOUNT_API_INTERNAL_TOKEN
      else
        process.env.ACCOUNT_API_INTERNAL_TOKEN = previousGeneric
      if (previousAi === undefined)
        delete process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN
      else
        process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN = previousAi
    }
  })

  it('uses server time for grant, reserve, settle and private reads', async () => {
    const db = makeFakeDb({})
    const common = {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
    }

    await handleGrantAiPointsForUser(db, {
      ...common,
      amountMicroPoints: 100_000,
      idempotencyKey: 'beta-grant:user_fixture_001:v1',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'ADV.JS beta',
      now: 1,
    }, { expectedToken: TOKEN, now: NOW })
    await handleReserveAiPointsForTask(db, {
      ...common,
      taskId: 'task_fixture_001',
      amountMicroPoints: 30_000,
      idempotencyKey: 'reserve:task_fixture_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
      now: 1,
    }, { expectedToken: TOKEN, now: NOW + 1 })
    await handleSettleAiPointsForTask(db, {
      ...common,
      taskId: 'task_fixture_001',
      chargedMicroPoints: 12_000,
      idempotencyKey: 'settle:task_fixture_001',
      now: 1,
    }, { expectedToken: TOKEN, now: NOW + 2 })

    await expect(handleGetAiPointAccountForUser(db, {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
    }, { expectedToken: TOKEN })).resolves.toMatchObject({
      availableMicroPoints: 88_000,
      reservedMicroPoints: 0,
      lifetimeChargedMicroPoints: 12_000,
    })
    const history = await handleListAiPointTransactionsForUser(db, {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      limit: 10,
    }, { expectedToken: TOKEN })
    expect(history.items.map(item => item.type)).toEqual(['settle', 'reserve', 'beta_grant'])
    expect(history.items.map(item => item.createdAt)).toEqual([NOW + 2, NOW + 1, NOW])
  })

  it.each([
    ['an administrator ban', {
      account_restrictions: [{
        _id: 'user_fixture_001',
        userId: 'user_fixture_001',
        type: 'admin_ban',
        status: 'active',
        reasonCode: 'policy_violation',
        createdAt: NOW,
      }],
    }, /账号已被封禁/],
    ['a pending account deletion', {
      user_profiles: [{
        _id: 'user_fixture_001',
        userId: 'user_fixture_001',
        deletionStatus: 'pending',
        deletionRequestedAt: NOW - 1_000,
        deletionScheduledAt: NOW + 86_400_000,
      }],
    }, /注销冷静期/],
  ])('rejects a new reservation during %s', async (_label, initial, expectedError) => {
    const db = makeFakeDb(initial)
    const common = {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
    }
    await handleGrantAiPointsForUser(db, {
      ...common,
      amountMicroPoints: 100_000,
      idempotencyKey: 'beta-grant:user_fixture_001:v1',
      actor: 'system',
    }, { expectedToken: TOKEN, now: NOW })

    await expect(handleReserveAiPointsForTask(db, {
      ...common,
      taskId: 'task_fixture_restricted_001',
      amountMicroPoints: 10_000,
      idempotencyKey: 'reserve:task_fixture_restricted_001',
      activeTaskExpiresAt: NOW + 10 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW + 1 })).rejects.toThrow(expectedError)

    const history = await handleListAiPointTransactionsForUser(db, {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      limit: 10,
    }, { expectedToken: TOKEN })
    expect(history.items.map(item => item.type)).toEqual(['beta_grant'])
  })
})
