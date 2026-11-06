import { describe, expect, it } from 'vitest'
import { purchaseAccountToken } from '../../cloudfunctions/wxpay-order/lib/iap-settlement.js'
import { grantIapTransaction, handleIapRefund } from '../../cloudfunctions/wxpay-order/lib/iap.js'
import { computeNewExpireAt } from '../../cloudfunctions/wxpay-order/lib/membership.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-01-31T10:00:00+08:00')
const aliceToken = 'ff339005-7476-82b1-9184-ea67c9516aa8'

function input(kind = 'coin', overrides = {}) {
  return {
    userId: 'alice',
    environment: 'Production',
    now: NOW,
    payload: {
      transactionId: '10001',
      originalTransactionId: '10001',
      bundleId: 'fun.yunle.apps',
      environment: 'Production',
      productId: kind === 'coin' ? 'fun.yunle.apps.coin_100' : 'fun.yunle.apps.member_month',
      price: 12000,
      currency: 'CNY',
      purchaseDate: NOW,
      appAccountToken: aliceToken,
    },
    ...overrides,
  }
}

function legacyOrder(kind, status = 'pending') {
  return {
    _id: 'old-random-order-id',
    userId: 'alice',
    appId: 'apps',
    payType: 'iap',
    outTradeNo: 'iap_10001',
    transactionId: '10001',
    status,
    orderType: kind === 'coin' ? 'recharge_coin' : 'membership',
    meta: { productId: kind === 'coin' ? 'fun.yunle.apps.coin_100' : 'fun.yunle.apps.member_month', environment: 'Production' },
    ...(kind === 'coin'
      ? { packId: 'coin_100', coinAmount: 100 }
      : { level: 'basic', planId: 'basic', billingCycle: 'month', providerPurchasedAt: NOW }),
  }
}

// Real callback rollback semantics in makeFakeDb, with injected SDK failures.
function interceptTransactionWrites(db, intercept) {
  const original = db.runTransaction
  db.runTransaction = callback => original(transaction => callback({
    collection(name) {
      const collection = transaction.collection(name)
      return {
        doc(id) {
          const ref = collection.doc(id)
          return {
            ...ref,
            async set(data) {
              const result = intercept(name, id, data)
              return result === undefined ? ref.set(data) : result
            },
          }
        },
      }
    },
  }))
  return () => {
    db.runTransaction = original
  }
}

describe('iAP account ownership', () => {
  it.each([
    ['alice', aliceToken],
    ['bob', 'cabb8aed-6b17-833b-ad66-1b077b8ade2f'],
    ['测试账号-1', '5afff4ae-ffe5-81bc-8c58-00216c02428b'],
  ])('matches native UUID v8 vector for %s', (uid, expected) => {
    expect(purchaseAccountToken(uid)).toBe(expected)
  })

  it.each([null, '', 'not-a-uuid', 'cabb8aed-6b17-833b-ad66-1b077b8ade2f'])('rejects malformed or wrong signed account token %s before writes', async (token) => {
    const db = makeFakeDb()
    const request = input()
    request.payload.appAccountToken = token
    await expect(grantIapTransaction(db, request)).rejects.toThrow('账号标记')
    expect(db._store).toEqual({})
  })

  it('accepts uppercase UUIDs returned by StoreKit', async () => {
    const db = makeFakeDb()
    const request = input()
    request.payload.appAccountToken = aliceToken.toUpperCase()
    await grantIapTransaction(db, request)
    expect(db._store.orders[0].meta.appAccountToken).toBe(aliceToken)
  })

  it('serializes simultaneous legacy first claims from two accounts', async () => {
    const db = makeFakeDb()
    const request = input()
    delete request.payload.appAccountToken
    const results = await Promise.allSettled([
      grantIapTransaction(db, request),
      grantIapTransaction(db, { ...request, userId: 'bob' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected').reason.message).toContain('已绑定其他账号')
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.coin_transactions).toHaveLength(1)
    expect(db._store.user_wallet).toHaveLength(1)
    expect(db._store.user_wallet[0]).toMatchObject({ userId: db._store.orders[0].userId, balance: 100 })
  })

  it.each(['coin', 'member'])('deduplicates ten concurrent %s verifications', async (kind) => {
    const db = makeFakeDb({}, { rejectDocumentIdWrites: true })
    const results = await Promise.all(Array.from({ length: 10 }, () => grantIapTransaction(db, input(kind))))
    expect(results.filter(r => r.granted)).toHaveLength(1)
    expect(results.filter(r => r.alreadyProcessed)).toHaveLength(9)
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.orders[0]).toMatchObject({ _id: 'iap_10001', grantedAt: NOW, iapSettlementVersion: 1 })
    if (kind === 'coin') {
      expect(db._store.user_wallet[0].balance).toBe(100)
      expect(db._store.coin_transactions).toHaveLength(1)
    }
    else {
      expect(db._store.user_memberships[0].expireAt).toBe(computeNewExpireAt({ current: null, cycle: 'month', now: NOW }))
    }
  })

  it('rechecks a legacy owner inside the transaction', async () => {
    const db = makeFakeDb({ orders: [legacyOrder('coin')] })
    const original = db.runTransaction
    db.runTransaction = (callback) => {
      db._store.orders[0].userId = 'bob'
      return original(callback)
    }
    await expect(grantIapTransaction(db, input())).rejects.toThrow('已绑定其他账号')
    expect(db._store.orders[0]).not.toHaveProperty('grantedAt')
    expect(db._store.coin_transactions || []).toHaveLength(0)
  })

  it('rejects duplicate legacy orders without selecting an arbitrary owner', async () => {
    const orders = [legacyOrder('coin'), { ...legacyOrder('coin'), _id: 'second', userId: 'bob' }]
    const db = makeFakeDb({ orders })
    await expect(grantIapTransaction(db, input())).rejects.toThrow('重复订单')
    expect(db._store.orders).toEqual(orders)
  })

  it.each([
    { environment: 'Sandbox' },
    { payload: { ...input().payload, productId: 'fun.yunle.apps.member_month' } },
    { payload: { ...input().payload, bundleId: 'other.app' } },
  ])('rejects an existing transaction with changed verified identity', async (override) => {
    const db = makeFakeDb()
    await grantIapTransaction(db, input())
    const before = structuredClone(db._store)
    await expect(grantIapTransaction(db, input('coin', override))).rejects.toThrow('不一致')
    expect(db._store).toEqual(before)
  })
})

describe('iAP atomic settlement and recovery', () => {
  it.each(['coin', 'member'])('rolls back %s entitlement when final order receipt fails, then retries once', async (kind) => {
    const db = makeFakeDb()
    const restore = interceptTransactionWrites(db, (name) => {
      if (name === 'orders')
        throw new Error('receipt unavailable')
    })
    await expect(grantIapTransaction(db, input(kind))).rejects.toThrow('receipt unavailable')
    expect(db._store.orders).toHaveLength(0)
    expect(db._store.user_wallet || []).toHaveLength(0)
    expect(db._store.coin_transactions || []).toHaveLength(0)
    expect(db._store.user_memberships || []).toHaveLength(0)
    restore()
    expect((await grantIapTransaction(db, input(kind))).granted).toBe(true)
    expect((await grantIapTransaction(db, input(kind))).alreadyProcessed).toBe(true)
    expect(db._store.orders).toHaveLength(1)
  })

  it('treats a resolved SDK error code as a transaction failure', async () => {
    const db = makeFakeDb()
    interceptTransactionWrites(db, name => name === 'orders' ? { code: 'DATABASE_ERROR' } : undefined)
    await expect(grantIapTransaction(db, input())).rejects.toThrow('数据库操作失败')
    expect(db._store.user_wallet || []).toHaveLength(0)
    expect(db._store.coin_transactions || []).toHaveLength(0)
  })

  it.each(['coin', 'member'])('recovers a lost %s response after commit without another grant', async (kind) => {
    const db = makeFakeDb()
    const original = db.runTransaction
    db.runTransaction = async (callback) => {
      await original(callback)
      throw new Error('response lost after commit')
    }
    await expect(grantIapTransaction(db, input(kind))).rejects.toThrow('response lost')
    const committed = structuredClone(db._store)
    db.runTransaction = original
    expect((await grantIapTransaction(db, input(kind))).alreadyProcessed).toBe(true)
    expect(db._store).toEqual(committed)
  })

  it('stacks two distinct concurrent membership orders and does not replay the older one', async () => {
    const db = makeFakeDb()
    const first = input('member')
    const second = input('member')
    second.payload.transactionId = '10002'
    await Promise.all([grantIapTransaction(db, first), grantIapTransaction(db, second)])
    expect(db._store.orders).toHaveLength(2)
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2026-03-31T10:00:00+08:00'))
    const after = structuredClone(db._store)
    await grantIapTransaction(db, first)
    expect(db._store).toEqual(after)
  })

  it.each(['coin', 'member'])('preserves a legacy pending %s order ID', async (kind) => {
    const db = makeFakeDb({ orders: [legacyOrder(kind)] })
    await grantIapTransaction(db, input(kind))
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.orders[0]).toMatchObject({ _id: 'old-random-order-id', grantedAt: NOW, status: 'paid' })
  })

  it.each(['coin', 'member'])('refunds a legacy pending %s order after verified settlement', async (kind) => {
    const old = legacyOrder(kind)
    old.meta.auditNote = 'preserve historical metadata'
    const db = makeFakeDb({ orders: [old] }, { rejectDocumentIdWrites: true })
    const request = input(kind)
    await grantIapTransaction(db, request)
    const settled = db._store.orders[0]
    expect(settled.meta).toEqual({ ...old.meta, bundleId: request.payload.bundleId })

    const refund = { payload: { ...request.payload, revocationDate: NOW + 1000 }, now: NOW + 1000 }
    const result = await handleIapRefund(db, refund)
    expect(result.handled).toBe(true)
    expect(db._store.orders[0]).toMatchObject({ _id: old._id, status: 'refunded' })
    if (kind === 'coin') {
      expect(result.clawed).toBe(100)
      expect(db._store.user_wallet[0].balance).toBe(0)
    }
    else {
      expect(result.entitlementReverted).toBe(true)
      expect(db._store.user_memberships[0].expireAt).toBe(refund.now)
    }
    const after = structuredClone(db._store)
    await handleIapRefund(db, refund)
    expect(db._store).toEqual(after)
  })

  it.each(['coin', 'member'])('repairs a verified paid %s order without regranting and permits refund', async (kind) => {
    const db = makeFakeDb({}, { rejectDocumentIdWrites: true })
    const request = input(kind)
    await grantIapTransaction(db, request)
    const order = db._store.orders[0]
    order._id = 'old-random-order-id'
    delete order.meta.bundleId
    const before = structuredClone(db._store)
    const result = await grantIapTransaction(db, { ...request, now: NOW + 1000 })
    expect(result).toMatchObject({ granted: false, alreadyProcessed: true })
    expect(db._store).toEqual({
      ...before,
      orders: [{ ...before.orders[0], meta: { ...before.orders[0].meta, bundleId: request.payload.bundleId }, updatedAt: NOW + 1000 }],
    })
    const repaired = structuredClone(db._store)
    await grantIapTransaction(db, { ...request, now: NOW + 2000 })
    expect(db._store).toEqual(repaired)
    expect((await handleIapRefund(db, {
      payload: { ...request.payload, revocationDate: NOW + 3000 },
      now: NOW + 3000,
    })).handled).toBe(true)
  })

  it('rolls back a failed paid order metadata repair before acknowledging it', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, input())
    delete db._store.orders[0].meta.bundleId
    const before = structuredClone(db._store)
    const restore = interceptTransactionWrites(db, name => name === 'orders' ? { code: 'DATABASE_ERROR' } : undefined)
    await expect(grantIapTransaction(db, input())).rejects.toThrow('数据库操作失败')
    expect(db._store).toEqual(before)
    restore()
    expect((await grantIapTransaction(db, input())).alreadyProcessed).toBe(true)
    expect(db._store.orders[0].meta.bundleId).toBe(input().payload.bundleId)
    expect(db._store.user_wallet[0].balance).toBe(100)
  })

  it.each(['owner', 'bundle', 'product', 'environment'])('does not backfill a legacy order with mismatched %s', async (mismatch) => {
    const old = legacyOrder('coin')
    if (mismatch === 'owner')
      old.userId = 'bob'
    else if (mismatch === 'bundle')
      old.meta.bundleId = 'other.app'
    else if (mismatch === 'product')
      old.meta.productId = 'fun.yunle.apps.member_month'
    else
      old.meta.environment = 'Sandbox'
    const db = makeFakeDb({ orders: [old] })
    const before = structuredClone(db._store)
    await expect(grantIapTransaction(db, input())).rejects.toThrow()
    expect(db._store).toEqual(before)
  })

  it('rechecks the legacy bundle inside the transaction before backfilling it', async () => {
    const db = makeFakeDb({ orders: [legacyOrder('coin')] })
    const original = db.runTransaction
    db.runTransaction = (callback) => {
      db._store.orders[0].meta.bundleId = 'other.app'
      return original(callback)
    }
    await expect(grantIapTransaction(db, input())).rejects.toThrow('不一致')
    expect(db._store.orders[0].meta.bundleId).toBe('other.app')
    expect(db._store.orders[0].status).toBe('pending')
    expect(db._store.user_wallet).toHaveLength(0)
    expect(db._store.coin_transactions).toHaveLength(0)
  })

  it('refuses to acknowledge an old paid membership with no durable grant proof', async () => {
    const db = makeFakeDb({
      orders: [legacyOrder('member', 'paid')],
      user_memberships: [{ _id: 'alice', lastOrderId: 'later-order', expireAt: NOW + 1000000 }],
    })
    const before = structuredClone(db._store)
    await expect(grantIapTransaction(db, input('member'))).rejects.toThrow('需人工核对')
    expect(db._store).toEqual(before)
  })

  it('repairs a proven legacy membership receipt without extending the membership or inventing a refund snapshot', async () => {
    const current = { _id: 'alice', lastOrderId: 'iap_10001', planId: 'basic', activeCycle: 'month', expireAt: NOW + 1000000 }
    const db = makeFakeDb({ orders: [legacyOrder('member', 'paid')], user_memberships: [current] })
    await grantIapTransaction(db, input('member'))
    expect(db._store.user_memberships).toEqual([current])
    expect(db._store.orders[0].grantedAt).toBe(NOW)
    expect(db._store.orders[0].meta.bundleId).toBe(input('member').payload.bundleId)
    expect(db._store.orders[0]).not.toHaveProperty('membershipGrant')
    const refund = await handleIapRefund(db, {
      payload: { ...input('member').payload, revocationDate: NOW + 1000 },
      now: NOW + 1000,
    })
    expect(refund.manualReviewRequired).toBe(true)
    expect(db._store.user_memberships).toEqual([current])
  })

  it.each(['orders', 'user_memberships', 'user_wallet', 'coin_transactions'])('does not treat a failed %s lookup as an empty collection', async (collectionName) => {
    const db = makeFakeDb()
    const original = db.collection
    db.collection = (name) => {
      const collection = original(name)
      if (name === collectionName) {
        collection.get = async () => ({ code: 'DATABASE_UNAVAILABLE' })
        if (name === 'user_memberships') {
          collection.doc = () => ({ get: async () => ({ code: 'DATABASE_UNAVAILABLE' }) })
        }
      }
      return collection
    }
    const kind = collectionName === 'user_memberships' ? 'member' : 'coin'
    await expect(grantIapTransaction(db, input(kind))).rejects.toThrow()
    expect(db._store.orders || []).toHaveLength(0)
    expect(db._store.user_memberships || []).toHaveLength(0)
    expect(db._store.user_wallet || []).toHaveLength(0)
    expect(db._store.coin_transactions || []).toHaveLength(0)
  })

  it('does not acknowledge a failed commit even if the callback produced a receipt', async () => {
    const db = makeFakeDb()
    const original = db.runTransaction
    db.runTransaction = async (callback) => {
      await original(callback)
      return { code: 'DATABASE_TRANSACTION_COMMIT_FAILED' }
    }
    await expect(grantIapTransaction(db, input())).rejects.toThrow('数据库操作失败')
  })

  it('preserves legacy membership fields and stacks from its existing period', async () => {
    const legacy = {
      _id: 'legacy-membership',
      userId: 'alice',
      expireAt: Date.parse('2026-02-28T10:00:00+08:00'),
      billingAnchorDay: 31,
      billingAnchorIsMonthEnd: true,
      planId: 'basic',
      extra: 'preserve',
    }
    const db = makeFakeDb({ user_memberships: [legacy] }, { rejectDocumentIdWrites: true })
    await grantIapTransaction(db, input('member'))
    const canonical = db._store.user_memberships.find(member => member._id === 'alice')
    expect(canonical).toMatchObject({ extra: 'preserve', expireAt: Date.parse('2026-03-31T10:00:00+08:00') })
    expect(canonical).not.toHaveProperty('userId')
    expect(db._store.user_memberships.find(member => member._id === 'legacy-membership')).toEqual(legacy)
    expect(db._store.orders[0].membershipGrant.expireBefore).toBe(legacy.expireAt)
  })

  it('repairs a paid coin receipt after another order without crediting again', async () => {
    const db = makeFakeDb()
    const first = input()
    await grantIapTransaction(db, first)
    delete db._store.orders[0].grantedAt
    delete db._store.orders[0].iapSettlementVersion
    delete db._store.orders[0].meta.bundleId
    const second = input()
    second.payload.transactionId = '10002'
    await grantIapTransaction(db, second)
    await grantIapTransaction(db, first)
    expect(db._store.user_wallet[0].balance).toBe(200)
    expect(db._store.coin_transactions).toHaveLength(2)
    expect(db._store.orders.every(order => order.grantedAt === NOW)).toBe(true)
    expect(db._store.orders[0].meta.bundleId).toBe(first.payload.bundleId)
    expect((await handleIapRefund(db, {
      payload: { ...first.payload, revocationDate: NOW + 1000 },
      now: NOW + 1000,
    })).clawed).toBe(100)
    expect(db._store.user_wallet[0].balance).toBe(100)
  })
})
