import { describe, expect, it } from 'vitest'

import {
  grantIapTransaction,
  handleIapRefund,
  priceToFen,
} from '../../functions/wxpay-order/lib/iap.js'
import { creditCoin, deductCoin } from '../../functions/wxpay-order/lib/wallet.js'
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

  it('云币订单退款：标 refunded 并全额追回，写负数 refund 流水', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })

    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    expect(result.handled).toBe(true)
    expect(result.clawed).toBe(100)
    expect(db._store.orders[0].status).toBe('refunded')
    expect(db._store.user_wallet[0].balance).toBe(0)
    // 流水：入账 recharge + 追回 refund
    const refundTx = db._store.coin_transactions.find(tx => tx.type === 'refund')
    expect(refundTx).toMatchObject({
      userId: 'u1',
      amount: -100,
      balanceAfter: 0,
      refId: 'iap_20001',
      meta: { source: 'appstore-refund', requested: 100, clawed: 100 },
    })
  })

  it('云币订单退款：余额已部分消费时扣到零封顶', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })
    await deductCoin(db, { userId: 'u1', appId: 'apps', amount: 60, bizId: 'C1', now: NOW + 1 })

    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    expect(result.clawed).toBe(40)
    expect(db._store.user_wallet[0].balance).toBe(0)
  })

  it('重复退款通知幂等：不重复扣减', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })
    await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    // 重试间隙用户重新充值，不应被第二次通知误扣
    await creditCoin(db, { userId: 'u1', appId: 'apps', amount: 500, refId: 'O_NEW', now: NOW + 1500 })
    const second = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 2000 })
    expect(second.handled).toBe(false)
    expect(db._store.user_wallet[0].balance).toBe(500)
    expect(db._store.coin_transactions.filter(tx => tx.type === 'refund')).toHaveLength(1)
  })

  it('订单已标 refunded 但追回中断：重试通知补偿追回', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: coinPayload(), environment: 'Production', now: NOW })
    // 模拟首轮在 conditional update 后崩溃：订单已 refunded，但没有 refund 流水
    db._store.orders[0].status = 'refunded'

    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW + 1000 })
    expect(result.handled).toBe(false)
    expect(result.clawed).toBe(100)
    expect(db._store.user_wallet[0].balance).toBe(0)
  })

  it('会员订单重复退款通知：不重复失效（保护其后新购会员）', async () => {
    const db = makeFakeDb()
    await grantIapTransaction(db, { userId: 'u1', payload: memberPayload(), environment: 'Production', now: NOW })
    await handleIapRefund(db, { payload: memberPayload(), now: NOW + 1000 })
    // 用户重新购买会员
    db._store.user_memberships[0].expireAt = NOW + 999_999_999
    const second = await handleIapRefund(db, { payload: memberPayload(), now: NOW + 2000 })
    expect(second.handled).toBe(false)
    expect(db._store.user_memberships[0].expireAt).toBe(NOW + 999_999_999)
  })

  it('订单不存在时不处理', async () => {
    const db = makeFakeDb()
    const result = await handleIapRefund(db, { payload: coinPayload(), now: NOW })
    expect(result.handled).toBe(false)
  })
})
