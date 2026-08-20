import { describe, expect, it } from 'vitest'

import {
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_RESERVATIONS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
  ensureAiPointAccount,
  grantAiPoints,
  releaseExpiredAiPointReservations,
  reserveAiPoints,
} from '../../cloudfunctions/account-api/ai-points.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-20T10:00:00+08:00')

describe('account-api AI point ledger v2', () => {
  it('creates one zero-balance account without a Beta gate or ledger transaction', async () => {
    const db = makeFakeDb({})

    const first = await ensureAiPointAccount(db, {
      userId: 'user_fixture_v2',
      now: NOW,
    })
    const replay = await ensureAiPointAccount(db, {
      userId: 'user_fixture_v2',
      now: NOW + 1,
    })

    expect(first).toMatchObject({
      initialized: true,
      created: true,
      account: {
        schemaVersion: 2,
        userId: 'user_fixture_v2',
        availableMicroPoints: 0,
        reservedMicroPoints: 0,
        activeReservationCount: 0,
        lifetimeGrantedMicroPoints: 0,
        lifetimeChargedMicroPoints: 0,
        version: 0,
      },
    })
    expect(first.account).not.toHaveProperty('access')
    expect(first.account).not.toHaveProperty('activeTask')
    expect(replay).toMatchObject({ created: false, account: first.account })
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION]).toHaveLength(1)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION] ?? []).toEqual([])
  })

  it('allows four task reservations and rejects the fifth without changing balances', async () => {
    const db = makeFakeDb({})
    await ensureAiPointAccount(db, { userId: 'user_fixture_v2', now: NOW })
    await grantAiPoints(db, {
      userId: 'user_fixture_v2',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      amountMicroPoints: 100_000,
      idempotencyKey: 'starter:user_fixture_v2:v1',
      actor: 'system',
      reason: 'starter entitlement',
      now: NOW + 1,
    })

    for (let index = 0; index < 4; index += 1) {
      await reserveAiPoints(db, {
        userId: 'user_fixture_v2',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId: `task_fixture_v2_${index}`,
        amountMicroPoints: 10_000,
        idempotencyKey: `reserve:task_fixture_v2_${index}`,
        reservationExpiresAt: NOW + 15 * 60 * 1000,
        now: NOW + index + 2,
      })
    }

    await expect(reserveAiPoints(db, {
      userId: 'user_fixture_v2',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      taskId: 'task_fixture_v2_4',
      amountMicroPoints: 10_000,
      idempotencyKey: 'reserve:task_fixture_v2_4',
      reservationExpiresAt: NOW + 15 * 60 * 1000,
      now: NOW + 10,
    })).rejects.toThrow(/并发预留已达上限/)

    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION][0]).toMatchObject({
      schemaVersion: 2,
      availableMicroPoints: 60_000,
      reservedMicroPoints: 40_000,
      activeReservationCount: 4,
    })
    expect(db._store[AI_POINT_RESERVATIONS_COLLECTION]).toHaveLength(4)
    expect(db._store[AI_POINT_RESERVATIONS_COLLECTION]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: 'user_fixture_v2',
        taskId: 'task_fixture_v2_0',
        status: 'active',
        reservedMicroPoints: 10_000,
      }),
    ]))
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toHaveLength(5)
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION][0]).toMatchObject({
      type: 'grant',
      idempotencyKey: 'starter:user_fixture_v2:v1',
    })
  })

  it('releases expired reservations through the canonical release transaction', async () => {
    const db = makeFakeDb({})
    await ensureAiPointAccount(db, { userId: 'user_fixture_v2', now: NOW })
    await grantAiPoints(db, {
      userId: 'user_fixture_v2',
      appId: 'yunlefun-ai',
      scope: 'hosted-ai-starter',
      amountMicroPoints: 100_000,
      idempotencyKey: 'starter:user_fixture_v2:expiry',
      actor: 'system',
      reason: 'starter entitlement',
      now: NOW + 1,
    })
    await reserveAiPoints(db, {
      userId: 'user_fixture_v2',
      appId: 'zero-echo-2026',
      scope: 'managed-chat',
      taskId: 'chat_fixture_expiry',
      amountMicroPoints: 10_000,
      idempotencyKey: 'reserve:chat_fixture_expiry',
      reservationExpiresAt: NOW + 100,
      now: NOW + 2,
    })

    await expect(releaseExpiredAiPointReservations(db, {
      now: NOW + 99,
      limit: 10,
    })).resolves.toEqual({ scanned: 0, released: 0, failed: 0 })
    await expect(releaseExpiredAiPointReservations(db, {
      now: NOW + 100,
      limit: 10,
    })).resolves.toEqual({ scanned: 1, released: 1, failed: 0 })
    await expect(releaseExpiredAiPointReservations(db, {
      now: NOW + 101,
      limit: 10,
    })).resolves.toEqual({ scanned: 0, released: 0, failed: 0 })

    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION][0]).toMatchObject({
      availableMicroPoints: 100_000,
      reservedMicroPoints: 0,
      activeReservationCount: 0,
    })
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'release',
        idempotencyKey: `reservation-expired:chat_fixture_expiry:${NOW + 100}`,
      }),
    ]))
  })
})
