import { describe, expect, it } from 'vitest'

import {
  COIN_RESERVATIONS_COLLECTION,
  COIN_TX_COLLECTION,
  commitCoinReservation,
  creditCoin,
  releaseCoinReservation,
  releaseExpiredCoinReservations,
  reserveCoin,
  WALLET_COLLECTION,
} from '../../cloudfunctions/account-api/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-20T12:00:00+08:00')

async function fundedDb() {
  const db = makeFakeDb({})
  await creditCoin(db, {
    userId: 'coin_user',
    appId: 'wallet',
    amount: 5,
    type: 'gift',
    refId: 'fund:coin_user',
    now: NOW,
  })
  return db
}

function reservationInput(extra = {}) {
  return {
    userId: 'coin_user',
    appId: 'everything-generator',
    amount: 3,
    reservationId: 'generation:fixture-001',
    expiresAt: NOW + 2 * 60 * 1000,
    now: NOW + 1,
    meta: { kind: 'aiChat' },
    ...extra,
  }
}

describe('account-api coin reservations', () => {
  it('reserves spendable coins before execution and commits one consume transaction', async () => {
    const db = await fundedDb()

    const reserved = await reserveCoin(db, reservationInput())
    const reserveReplay = await reserveCoin(db, reservationInput({ now: NOW + 2 }))

    expect(reserved).toMatchObject({
      deduped: false,
      reservation: {
        reservationId: 'generation:fixture-001',
        status: 'active',
        amount: 3,
      },
      balance: 2,
      reserved: 3,
    })
    expect(reserveReplay).toMatchObject({ deduped: true, balance: 2, reserved: 3 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)

    await expect(reserveCoin(db, reservationInput({
      reservationId: 'generation:fixture-002',
      now: NOW + 3,
    }))).rejects.toThrow(/云币余额不足/)

    const committed = await commitCoinReservation(db, {
      userId: 'coin_user',
      appId: 'everything-generator',
      reservationId: 'generation:fixture-001',
      now: NOW + 4,
    })
    const commitReplay = await commitCoinReservation(db, {
      userId: 'coin_user',
      appId: 'everything-generator',
      reservationId: 'generation:fixture-001',
      now: NOW + 5,
    })

    expect(committed).toMatchObject({
      deduped: false,
      reservation: { status: 'committed' },
      balance: 2,
      reserved: 0,
    })
    expect(commitReplay).toMatchObject({ deduped: true, balance: 2, reserved: 0 })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 2, reserved: 0 })
    expect(db._store[COIN_TX_COLLECTION]).toEqual([
      expect.objectContaining({ type: 'gift', amount: 5, balanceAfter: 5 }),
      expect.objectContaining({
        type: 'consume',
        appId: 'everything-generator',
        amount: -3,
        balanceAfter: 2,
        refId: 'generation:fixture-001',
      }),
    ])
  })

  it('releases a failed generation without writing a consume transaction', async () => {
    const db = await fundedDb()
    await reserveCoin(db, reservationInput())

    const released = await releaseCoinReservation(db, {
      userId: 'coin_user',
      appId: 'everything-generator',
      reservationId: 'generation:fixture-001',
      reason: 'provider_timeout_without_result',
      now: NOW + 2,
    })
    const replay = await releaseCoinReservation(db, {
      userId: 'coin_user',
      appId: 'everything-generator',
      reservationId: 'generation:fixture-001',
      reason: 'provider_timeout_without_result',
      now: NOW + 3,
    })

    expect(released).toMatchObject({
      deduped: false,
      reservation: { status: 'released' },
      balance: 5,
      reserved: 0,
    })
    expect(replay).toMatchObject({ deduped: true, balance: 5, reserved: 0 })
    expect(db._store[COIN_RESERVATIONS_COLLECTION]).toHaveLength(1)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })

  it('releases only expired active reservations through a bounded recovery pass', async () => {
    const db = await fundedDb()
    await reserveCoin(db, reservationInput({
      amount: 2,
      expiresAt: NOW + 100,
    }))

    await expect(releaseExpiredCoinReservations(db, {
      now: NOW + 99,
      limit: 10,
    })).resolves.toEqual({ scanned: 0, released: 0, failed: 0 })
    await expect(releaseExpiredCoinReservations(db, {
      now: NOW + 100,
      limit: 10,
    })).resolves.toEqual({ scanned: 1, released: 1, failed: 0 })
    await expect(releaseExpiredCoinReservations(db, {
      now: NOW + 101,
      limit: 10,
    })).resolves.toEqual({ scanned: 0, released: 0, failed: 0 })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 5, reserved: 0 })
  })
})
