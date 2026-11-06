import { describe, expect, it, vi } from 'vitest'
import { grantIapTransaction, handleIapRefund } from '../../cloudfunctions/wxpay-order/lib/iap.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1750000000000
function payload(kind, environment = 'Production') {
  return {
    transactionId: '20001',
    originalTransactionId: '20001',
    productId: kind === 'coin' ? 'fun.yunle.apps.coin_100' : 'fun.yunle.apps.member_month',
    bundleId: 'fun.yunle.apps',
    environment,
    purchaseDate: NOW,
    price: 12000,
    currency: 'CNY',
  }
}

describe('iAP production entitlement boundary', () => {
  it.each(['coin', 'member'])('rejects a verified Sandbox %s purchase before any database access', async (kind) => {
    const db = makeFakeDb()
    vi.spyOn(db, 'collection')
    vi.spyOn(db, 'runTransaction')
    await expect(grantIapTransaction(db, {
      userId: 'alice',
      payload: payload(kind, 'Sandbox'),
      environment: 'Sandbox',
      now: NOW,
    })).rejects.toMatchObject({ code: 'IAP_ENVIRONMENT_UNSUPPORTED' })
    expect(db.collection).not.toHaveBeenCalled()
    expect(db.runTransaction).not.toHaveBeenCalled()
  })

  it.each(['coin', 'member'])('does not refund a Production %s order with a Sandbox transaction of the same ID', async (kind) => {
    const db = makeFakeDb()
    await grantIapTransaction(db, {
      userId: 'alice',
      payload: payload(kind),
      environment: 'Production',
      now: NOW,
    })
    const before = structuredClone(db._store)
    await expect(handleIapRefund(db, {
      payload: { ...payload(kind, 'Sandbox'), revocationDate: NOW + 1000 },
      now: NOW + 1000,
    })).rejects.toMatchObject({ code: 'IAP_ENVIRONMENT_UNSUPPORTED' })
    expect(db._store).toEqual(before)
  })

  it.each([undefined, '', 'Xcode', 'sandbox', null])('rejects missing or unknown signed environment %s for grants and refunds', async (environment) => {
    const db = makeFakeDb()
    vi.spyOn(db, 'collection')
    vi.spyOn(db, 'runTransaction')
    const transaction = { ...payload('coin'), environment }
    await expect(grantIapTransaction(db, {
      userId: 'alice',
      payload: transaction,
      environment: 'Production',
      now: NOW,
    })).rejects.toThrow('环境')
    await expect(handleIapRefund(db, { payload: transaction, now: NOW })).rejects.toThrow('环境')
    expect(db.collection).not.toHaveBeenCalled()
    expect(db.runTransaction).not.toHaveBeenCalled()
  })

  it.each(['Sandbox', undefined])('does not refund a historical order whose stored environment is %s', async (environment) => {
    const db = makeFakeDb()
    await grantIapTransaction(db, {
      userId: 'alice',
      payload: payload('coin'),
      environment: 'Production',
      now: NOW,
    })
    db._store.orders[0].meta.environment = environment
    const before = structuredClone(db._store)
    await expect(handleIapRefund(db, {
      payload: { ...payload('coin'), revocationDate: NOW + 1000 },
      now: NOW + 1000,
    })).rejects.toThrow('不一致')
    expect(db._store).toEqual(before)
  })

  it('does not refund a transaction whose stored bundle differs', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, {
      userId: 'alice',
      payload: payload('coin'),
      environment: 'Production',
      now: NOW,
    })
    db._store.orders[0].meta.bundleId = 'other.app'
    const before = structuredClone(db._store)
    await expect(handleIapRefund(db, {
      payload: { ...payload('coin'), revocationDate: NOW + 1000 },
      now: NOW + 1000,
    })).rejects.toThrow('不一致')
    expect(db._store).toEqual(before)
  })
})
