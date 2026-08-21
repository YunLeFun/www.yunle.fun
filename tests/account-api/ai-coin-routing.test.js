import { describe, expect, it } from 'vitest'

import {
  AI_COIN_INTERNAL_ACTIONS,
  dispatchAiCoinInternalAction,
  isAiCoinInternalAction,
} from '../../cloudfunctions/account-api/ai-coin-routing.js'
import { creditCoin } from '../../cloudfunctions/account-api/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-20T12:30:00+08:00')
const TOKEN = 'ai-runtime-coin-account-token'

describe('account-api AI coin routing', () => {
  it('exposes only reserve, commit and release through a dedicated credential', async () => {
    expect([...AI_COIN_INTERNAL_ACTIONS].sort()).toEqual([
      'commitCoinForAiTask',
      'releaseCoinForAiTask',
      'releaseExpiredCoinReservations',
      'reserveCoinForAiTask',
    ])
    expect(isAiCoinInternalAction('reserveCoinForAiTask')).toBe(true)
    expect(isAiCoinInternalAction('deductCoinForUser')).toBe(false)

    const db = makeFakeDb({})
    await creditCoin(db, {
      userId: 'coin_user',
      appId: 'wallet',
      amount: 2,
      type: 'gift',
      refId: 'fund:coin_user',
      now: NOW,
    })

    await expect(dispatchAiCoinInternalAction(db, {
      action: 'reserveCoinForAiTask',
      serviceToken: 'wrong-token',
      userId: 'coin_user',
      appId: 'everything-generator',
      amount: 1,
      reservationId: 'generation:routing-fixture',
      expiresAt: NOW + 2 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW + 1 })).rejects.toThrow(/内部服务鉴权失败/)

    await expect(dispatchAiCoinInternalAction(db, {
      action: 'reserveCoinForAiTask',
      serviceToken: TOKEN,
      userId: 'coin_user',
      appId: 'everything-generator',
      amount: 1,
      reservationId: 'generation:routing-fixture',
      expiresAt: NOW + 2 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW + 1 })).resolves.toMatchObject({
      balance: 1,
      reserved: 1,
      reservation: { status: 'active' },
    })

    await expect(dispatchAiCoinInternalAction(db, {
      action: 'commitCoinForAiTask',
      serviceToken: TOKEN,
      userId: 'coin_user',
      appId: 'everything-generator',
      reservationId: 'generation:routing-fixture',
    }, { expectedToken: TOKEN, now: NOW + 2 })).resolves.toMatchObject({
      balance: 1,
      reserved: 0,
      reservation: { status: 'committed' },
    })

    await expect(dispatchAiCoinInternalAction(db, {
      action: 'releaseExpiredCoinReservations',
      serviceToken: TOKEN,
      limit: 10,
    }, { expectedToken: TOKEN, now: NOW + 3 })).resolves.toEqual({
      scanned: 0,
      released: 0,
      failed: 0,
    })
  })

  it('fails closed for a managed synthetic identity before reserving coin', async () => {
    const db = makeFakeDb({
      test_identities: [{
        _id: 'managed_identity',
        uid: 'managed_synthetic_user',
        synthetic: true,
        source: 'managed',
        status: 'leased',
      }],
    })
    await creditCoin(db, {
      userId: 'managed_synthetic_user',
      appId: 'wallet',
      amount: 2,
      type: 'gift',
      refId: 'fund:managed_synthetic_user',
      now: NOW,
    })

    await expect(dispatchAiCoinInternalAction(db, {
      action: 'reserveCoinForAiTask',
      serviceToken: TOKEN,
      userId: 'managed_synthetic_user',
      appId: 'everything-generator',
      amount: 1,
      reservationId: 'generation:synthetic-fixture',
      expiresAt: NOW + 2 * 60 * 1000,
    }, { expectedToken: TOKEN, now: NOW + 1 })).rejects.toMatchObject({
      code: 'synthetic_action_forbidden',
    })

    expect(db._store.coin_reservations ?? []).toHaveLength(0)
    expect(db._store.user_wallet[0]).toMatchObject({ balance: 2 })
    expect(db._store.user_wallet[0].reserved ?? 0).toBe(0)
  })
})
