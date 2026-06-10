import { describe, expect, it } from 'vitest'

import {
  grantIapTransaction,
  handleIapRefund,
  priceToFen,
} from '../../functions/wxpay-order/lib/iap.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1750000000000

function coinPayload(overrides = {}) {
  return {
    transactionId: '20001',
    originalTransactionId: '20001',
    productId: 'fun.yunle.apps.coin_100',
    bundleId: 'fun.yunle.apps',
    price: 12000,
    currency: 'CNY',
    ...overrides,
  }
}

function memberPayload(overrides = {}) {
  return {
    transactionId: '30001',
    originalTransactionId: '30001',
    productId: 'fun.yunle.apps.member_month',
    bundleId: 'fun.yunle.apps',
    price: 12000,
    currency: 'CNY',
    ...overrides,
  }
}

describe('priceToFen', () => {
  it('cNY 毫单位换算为分', () => {
    expect(priceToFen({ price: 12000, currency: 'CNY' })).toBe(1200)
  })

  it('非 CNY 返回 0', () => {
    expect(priceToFen({ price: 1990, currency: 'USD' })).toBe(0)
    expect(priceToFen({ currency: 'CNY' })).toBe(0)
  })
})

describe('grantIapTransaction - 云币', () => {
  it('首次发放：建单、标 paid、入账 100 云币', async () => {
    const db = makeFakeDb()
    const result = await grantIapTransaction(db, {
      userId: 'u1',
      payload: coinPayload(),
      environment: 'Production',
      now: NOW,
    })
    expect(result.granted).toBe(true)
    expect(result.outTradeNo).toBe('iap_20001')

    const order = db._store.orders[0]
    expect(order.status).toBe('paid')
    expect(order.payType).toBe('iap')
    expect(order.coinAmount).toBe(100)
    expect(order.amount).toBe(1200)

    expect(db._store.user_wallet[0].balance).toBe(100)
    expect(db._store.coin_transactions[0].refId).toBe('iap_20001')
  })

  it('重复调用幂等：不重复入账', async () => {
    const db = makeFakeDb()
    const input = { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW }
    await grantIapTransaction(db, input)
    const second = await grantIapTransaction(db, input)
    expect(second.granted).toBe(false)
    expect(second.alreadyProcessed).toBe(true)
    expect(db._store.user_wallet[0].balance).toBe(100)
    expect(db._store.coin_transactions).toHaveLength(1)
  })

  it('防串号：交易已绑定其他账号时拒绝', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })
    await expect(
      grantIapTransaction(db, { userId: 'u2', payload: coinPayload(), environment: 'Production', now: NOW }),
    ).rejects.toThrow('已绑定其他账号')
  })

  it('未知商品拒绝', async () => {
    const db = makeFakeDb()
    await expect(
      grantIapTransaction(db, {
        userId: 'u1',
        payload: coinPayload({ productId: 'fun.yunle.apps.unknown' }),
        environment: 'Production',
        now: NOW,
      }),
    ).rejects.toThrow('无效 IAP 商品')
  })
})

describe('grantIapTransaction - 会员', () => {
  it('首次发放：开通月度会员', async () => {
    const db = makeFakeDb()
    const result = await grantIapTransaction(db, {
      userId: 'u1',
      payload: memberPayload(),
      environment: 'Sandbox',
      now: NOW,
    })
    expect(result.granted).toBe(true)

    const order = db._store.orders[0]
    expect(order.orderType).toBe('membership')
    expect(order.level).toBe('basic')
    expect(order.billingCycle).toBe('month')
    expect(order.meta.environment).toBe('Sandbox')

    const membership = db._store.user_memberships[0]
    expect(membership.userId).toBe('u1')
    // 月度 = 31 天
    expect(membership.expireAt).toBe(NOW + 31 * 86_400_000)
  })

  it('重复调用幂等：到期日不叠加', async () => {
    const db = makeFakeDb()
    const input = { userId: 'u1', payload: memberPayload(), environment: 'Production', now: NOW }
    await grantIapTransaction(db, input)
    await grantIapTransaction(db, input)
    expect(db._store.user_memberships[0].expireAt).toBe(NOW + 31 * 86_400_000)
  })
})

describe('handleIapRefund', () => {
  it('会员订单退款：订单标 refunded + 会员立即失效', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: memberPayload(), environment: 'Production', now: NOW })

    const result = await handleIapRefund(db, { payload: memberPayload(), now: NOW + 1000 })
    expect(result.handled).toBe(true)
    expect(db._store.orders[0].status).toBe('refunded')
    expect(db._store.user_memberships[0].expireAt).toBe(NOW + 1000)
  })

  it('云币订单退款：仅标 refunded，不自动追回余额', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })

    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    expect(result.handled).toBe(true)
    expect(db._store.orders[0].status).toBe('refunded')
    expect(db._store.user_wallet[0].balance).toBe(100)
  })

  it('重复退款通知幂等', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })
    await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    const second = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 2000 })
    expect(second.handled).toBe(false)
  })

  it('订单不存在时不处理', async () => {
    const db = makeFakeDb()
    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW })
    expect(result.handled).toBe(false)
  })
})
