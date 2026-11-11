import { describe, expect, it } from 'vitest'
import { purchaseAccountToken } from '../../cloudfunctions/wxpay-order/lib/iap-settlement.js'
import { grantIapTransaction, handleIapRefund } from '../../cloudfunctions/wxpay-order/lib/iap.js'
import { getIapApplication, getIapProduct } from '../../cloudfunctions/wxpay-order/lib/plans.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const now = Date.parse('2026-01-31T10:00:00+08:00')
function input(overrides = {}) {
  return {
    userId: 'alice',
    environment: 'Production',
    now,
    payload: {
      transactionId: '70001',
      originalTransactionId: '70001',
      bundleId: 'fun.yunle.cook',
      productId: 'fun.yunle.cook.member_month',
      type: 'Non-Renewing Subscription',
      environment: 'Production',
      appAccountToken: purchaseAccountToken('alice'),
      purchaseDate: now,
      ...overrides,
    },
  }
}

describe('cook application-scoped IAP catalog', () => {
  it('requires an exact registered bundle and rejects cross-application SKUs', () => {
    expect(getIapApplication('fun.yunle.cook').appId).toBe('cook')
    expect(getIapProduct('fun.yunle.apps.member_month').billingCycle).toBe('month')
    expect(() => getIapProduct('fun.yunle.apps.member_month', 'fun.yunle.cook')).toThrow('无效 IAP 商品')
    expect(() => getIapProduct('fun.yunle.cook.member_month', 'fun.yunle.apps')).toThrow('无效 IAP 商品')
    expect(() => getIapApplication('fun.yunle.cook.other')).toThrow('未登记')
    expect(() => getIapProduct('__proto__', 'fun.yunle.cook')).toThrow('无效 IAP 商品')
    expect(() => getIapApplication('__proto__')).toThrow('未登记')
  })

  it('settles and replays the Cook order atomically without extending twice', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, input())
    const expiry = db._store.user_memberships[0].expireAt
    const replay = await grantIapTransaction(db, input())
    expect(replay.alreadyProcessed).toBe(true)
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.orders[0].appId).toBe('cook')
    expect(db._store.orders[0].meta.bundleId).toBe('fun.yunle.cook')
    expect(db._store.user_memberships[0].expireAt).toBe(expiry)
  })

  it('rejects missing owner markers and other accounts before creating an order', async () => {
    const missing = input()
    delete missing.payload.appAccountToken
    const missingDb = makeFakeDb()
    await expect(grantIapTransaction(missingDb, missing)).rejects.toThrow('必须包含购买账号标记')
    expect(missingDb._store.orders || []).toHaveLength(0)
    for (const override of [{ appAccountToken: undefined }, { appAccountToken: purchaseAccountToken('bob') }]) {
      const db = makeFakeDb()
      await expect(grantIapTransaction(db, input(override))).rejects.toThrow('账号')
      expect(db._store.orders || []).toHaveLength(0)
      expect(db._store.user_memberships || []).toHaveLength(0)
    }
  })

  it('rejects unsupported subscription types instead of treating renewals as one-time credits', async () => {
    const db = makeFakeDb()
    await expect(grantIapTransaction(db, input({ type: 'Auto-Renewable Subscription' }))).rejects.toThrow('交易类型')
    expect(db._store.orders || []).toHaveLength(0)
  })

  it('restores the previous Web entitlement when refunding the latest Apple purchase', async () => {
    const expiry = now + 14 * 86400_000
    const db = makeFakeDb({ user_memberships: [{ _id: 'alice', planId: 'basic', expireAt: expiry, lastOrderId: 'web-before', activeCycle: 'month' }] })
    const purchase = input()
    await grantIapTransaction(db, purchase)
    const result = await handleIapRefund(db, { payload: { ...purchase.payload, revocationDate: now + 1 }, now: now + 1 })
    expect(result.entitlementReverted).toBe(true)
    expect(db._store.user_memberships[0].expireAt).toBe(expiry)
    expect(db._store.user_memberships[0].lastOrderId).toBe('web-before')
  })

  it('preserves a later Web purchase and sends ambiguous refund rollback to review', async () => {
    const db = makeFakeDb()
    const purchase = input()
    await grantIapTransaction(db, purchase)
    const membership = db._store.user_memberships[0]
    membership.lastOrderId = 'web-after'
    membership.expireAt += 365 * 86400_000
    const expiry = membership.expireAt
    const result = await handleIapRefund(db, { payload: { ...purchase.payload, revocationDate: now + 1 }, now: now + 1 })
    expect(result.manualReviewRequired).toBe(true)
    expect(membership.expireAt).toBe(expiry)
    expect(membership.lastOrderId).toBe('web-after')
  })
})
