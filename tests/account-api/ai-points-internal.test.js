import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { AI_POINT_TRANSACTIONS_COLLECTION } from '../../cloudfunctions/account-api/ai-points.js'
import {
  handleEnsureHostedAiStarterEntitlementForUser,
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

  it('accepts the dedicated YunLeFun Runtime token, preserves the legacy token and fails on conflicts', async () => {
    const names = [
      'YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN',
      'YUNLEFUN_AI_ACCOUNT_API_TOKEN',
      'ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN',
    ]
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
    try {
      process.env.YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN = TOKEN
      delete process.env.YUNLEFUN_AI_ACCOUNT_API_TOKEN
      delete process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN
      await expect(handleGetAiPointAccountForUser(makeFakeDb({}), {
        serviceToken: TOKEN,
        userId: 'user_fixture_001',
      })).resolves.toBeNull()

      delete process.env.YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN
      process.env.ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN = TOKEN
      await expect(handleGetAiPointAccountForUser(makeFakeDb({}), {
        serviceToken: TOKEN,
        userId: 'user_fixture_001',
      })).resolves.toBeNull()

      process.env.YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN = 'different-runtime-token'
      await expect(handleGetAiPointAccountForUser(makeFakeDb({}), {
        serviceToken: TOKEN,
        userId: 'user_fixture_001',
      })).rejects.toThrow(/配置冲突/)
    }
    finally {
      for (const name of names) {
        if (previous[name] === undefined)
          delete process.env[name]
        else
          process.env[name] = previous[name]
      }
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
      reservationExpiresAt: NOW + 10 * 60 * 1000,
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
    expect(history.items.map(item => item.type)).toEqual(['settle', 'reserve', 'grant'])
    expect(history.items.map(item => item.createdAt)).toEqual([NOW + 2, NOW + 1, NOW])
  })

  it('grants 100 starter points, then only the 200 point membership delta', async () => {
    const db = makeFakeDb({})
    const event = {
      serviceToken: TOKEN,
      userId: 'user_starter_fixture',
    }

    const standard = await handleEnsureHostedAiStarterEntitlementForUser(db, event, {
      expectedToken: TOKEN,
      now: NOW,
    })
    const standardReplay = await handleEnsureHostedAiStarterEntitlementForUser(db, event, {
      expectedToken: TOKEN,
      now: NOW + 1,
    })
    expect(standard).toMatchObject({
      membershipActive: false,
      targetMicroPoints: 100_000,
      account: {
        availableMicroPoints: 100_000,
        lifetimeGrantedMicroPoints: 100_000,
      },
    })
    expect(standardReplay.account).toMatchObject({
      availableMicroPoints: 100_000,
      lifetimeGrantedMicroPoints: 100_000,
    })

    await db.collection('user_memberships').doc('user_starter_fixture').set({
      userId: 'user_starter_fixture',
      level: 'pro',
      expireAt: NOW + 30 * 24 * 60 * 60 * 1000,
    })
    const member = await handleEnsureHostedAiStarterEntitlementForUser(db, event, {
      expectedToken: TOKEN,
      now: NOW + 2,
    })
    const memberReplay = await handleEnsureHostedAiStarterEntitlementForUser(db, event, {
      expectedToken: TOKEN,
      now: NOW + 3,
    })

    expect(member).toMatchObject({
      membershipActive: true,
      targetMicroPoints: 300_000,
      account: {
        availableMicroPoints: 300_000,
        lifetimeGrantedMicroPoints: 300_000,
      },
    })
    expect(memberReplay.account).toMatchObject({ availableMicroPoints: 300_000 })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION].map(item => ({
      type: item.type,
      amount: item.availableDelta,
      rule: item.meta.rule,
    }))).toEqual([
      { type: 'grant', amount: 100_000, rule: 'hosted-ai-starter-standard-v1' },
      { type: 'grant', amount: 200_000, rule: 'hosted-ai-starter-member-v1' },
    ])
  })

  it('does not grant or reserve hosted AI points for a managed synthetic identity', async () => {
    const db = makeFakeDb({
      test_identities: [{
        _id: 'managed_identity',
        uid: 'managed_synthetic_user',
        synthetic: true,
        source: 'managed',
        status: 'leased',
      }],
    })
    const common = {
      serviceToken: TOKEN,
      userId: 'managed_synthetic_user',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
    }

    await expect(handleEnsureHostedAiStarterEntitlementForUser(db, common, {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toMatchObject({ code: 'synthetic_action_forbidden' })
    await expect(handleReserveAiPointsForTask(db, {
      ...common,
      taskId: 'task_managed_synthetic',
      amountMicroPoints: 10_000,
      idempotencyKey: 'reserve:task_managed_synthetic',
      reservationExpiresAt: NOW + 10 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW })).rejects.toMatchObject({
      code: 'synthetic_action_forbidden',
    })

    expect(db._store.ai_point_accounts ?? []).toHaveLength(0)
    expect(db._store.ai_point_reservations ?? []).toHaveLength(0)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION] ?? []).toHaveLength(0)
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
      reservationExpiresAt: NOW + 10 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW + 1 })).rejects.toThrow(expectedError)

    const history = await handleListAiPointTransactionsForUser(db, {
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      limit: 10,
    }, { expectedToken: TOKEN })
    expect(history.items.map(item => item.type)).toEqual(['grant'])
  })
})
