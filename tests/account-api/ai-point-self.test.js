import { describe, expect, it } from 'vitest'

import {
  handleGetMyAiPointAccount,
  handleListMyAiPointTransactions,
} from '../../cloudfunctions/account-api/ai-point-self.js'
import {
  adjustAiPoints,
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
  grantAiPoints,
} from '../../cloudfunctions/account-api/ai-points.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-18T10:00:00+08:00')

async function seedAccount(db, userId = 'user_fixture_001') {
  await grantAiPoints(db, {
    userId,
    appId: 'advjs-studio',
    scope: 'studio-managed-ai',
    amountMicroPoints: 100_000,
    idempotencyKey: `beta-grant:${userId}:v1`,
    actor: 'admin',
    operator: 'owner_fixture',
    reason: 'Beta access',
    meta: { privateCampaign: 'must-not-leak' },
    now: NOW,
  })
}

describe('account-api self-service AI point reads', () => {
  it('initializes a zero-balance v2 account on the first authenticated read', async () => {
    const db = makeFakeDb({})

    await expect(handleGetMyAiPointAccount(db, 'user_missing', { now: NOW })).resolves.toEqual({
      schemaVersion: 2,
      account: {
        initialized: true,
        availableMicroPoints: 0,
        reservedMicroPoints: 0,
        activeReservationCount: 0,
        lifetimeGrantedMicroPoints: 0,
        lifetimeChargedMicroPoints: 0,
        updatedAt: NOW,
      },
    })
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION]).toHaveLength(1)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION] ?? []).toEqual([])
  })

  it('derives ownership from the caller argument and returns strict public projections', async () => {
    const db = makeFakeDb({})
    await seedAccount(db, 'caller_user')
    await seedAccount(db, 'spoofed_user')

    const account = await handleGetMyAiPointAccount(db, 'caller_user')
    expect(account.account).toEqual({
      initialized: true,
      availableMicroPoints: 100_000,
      reservedMicroPoints: 0,
      activeReservationCount: 0,
      lifetimeGrantedMicroPoints: 100_000,
      lifetimeChargedMicroPoints: 0,
      updatedAt: NOW,
    })
    expect(account.account).not.toHaveProperty('userId')
    expect(account.account).not.toHaveProperty('daily')
    expect(account.account).not.toHaveProperty('version')

    const page = await handleListMyAiPointTransactions(db, 'caller_user', {
      userId: 'spoofed_user',
      limit: 10,
    }, { now: NOW + 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toEqual(expect.objectContaining({
      type: 'grant',
      appId: 'advjs-studio',
      availableDelta: 100_000,
      availableAfter: 100_000,
      createdAt: NOW,
    }))
    for (const hidden of ['userId', 'idempotencyKey', 'operationHash', 'actor', 'operator', 'reason', 'meta', 'resultAccount'])
      expect(page.items[0]).not.toHaveProperty(hidden)
  })

  it('uses an opaque snapshot cursor so later writes do not shift subsequent pages', async () => {
    const db = makeFakeDb({})
    await seedAccount(db)
    await adjustAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      deltaMicroPoints: 10_000,
      idempotencyKey: 'adjust:user_fixture_001:before-cursor',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'Before cursor',
      now: NOW + 1,
    })

    const first = await handleListMyAiPointTransactions(db, 'user_fixture_001', {
      limit: 1,
    }, { now: NOW + 2 })
    expect(first.items.map(item => item.type)).toEqual(['adjust'])
    expect(first.nextCursor).toMatch(/^[\w-]+$/)
    expect(first).not.toHaveProperty('nextSkip')

    await adjustAiPoints(db, {
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      deltaMicroPoints: 5_000,
      idempotencyKey: 'adjust:user_fixture_001:after-cursor',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'After cursor',
      // 即使新写入与首屏快照落在同一毫秒，也不能挤动第二页。
      now: NOW + 2,
    })

    const second = await handleListMyAiPointTransactions(db, 'user_fixture_001', {
      cursor: first.nextCursor,
      limit: 1,
    }, { now: NOW + 4 })
    expect(second.items.map(item => item.type)).toEqual(['grant'])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects malformed cursors instead of falling back to the first page', async () => {
    await expect(handleListMyAiPointTransactions(makeFakeDb({}), 'user_fixture_001', {
      cursor: 'not-a-valid-cursor',
    }, { now: NOW })).rejects.toThrow(/AI 点数流水游标无效/)
  })
})
