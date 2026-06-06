import { describe, expect, it } from 'vitest'

import { grantOrderEntitlement, MEMBERSHIPS_COLLECTION } from '../../functions/wxpay-order/lib/orders.js'
import { DAY_MS } from '../../functions/wxpay-order/lib/plans.js'
import {
  COIN_TX_COLLECTION,
  creditCoin,
  deductCoin,
  getBalance,
  getWallet,
  WALLET_COLLECTION,
} from '../../functions/wxpay-order/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

describe('creditCoin', () => {
  it('首次充值：创建钱包并入账，写一条 recharge 流水', async () => {
    const db = makeFakeDb({})
    const res = await creditCoin(db, { userId: 'u1', appId: 'yunle', amount: 100, refId: 'O1', now: NOW })
    expect(res.balance).toBe(100)
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ userId: 'u1', balance: 100, version: 1 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      appId: 'yunle',
      type: 'recharge',
      amount: 100,
      balanceAfter: 100,
      refId: 'O1',
    })
  })

  it('已有钱包：累加余额并 version+1', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 500, version: 3 }],
    })
    const res = await creditCoin(db, { userId: 'u1', appId: 'a', amount: 100, refId: 'O2', now: NOW })
    expect(res.balance).toBe(600)
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 600, version: 4 })
  })

  it('同 refId 重复充值幂等：不重复入账', async () => {
    const db = makeFakeDb({})
    await creditCoin(db, { userId: 'u1', appId: 'a', amount: 100, refId: 'DUP', now: NOW })
    const res = await creditCoin(db, { userId: 'u1', appId: 'a', amount: 100, refId: 'DUP', now: NOW })
    expect(res).toMatchObject({ balance: 100, deduped: true })
    expect(await getBalance(db, 'u1')).toBe(100)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })

  it('amount 非正整数抛错', async () => {
    const db = makeFakeDb({})
    await expect(creditCoin(db, { userId: 'u1', amount: 0, now: NOW })).rejects.toThrow(/正整数/)
    await expect(creditCoin(db, { userId: 'u1', amount: 1.5, now: NOW })).rejects.toThrow(/正整数/)
  })
})

describe('deductCoin', () => {
  it('正常扣减：余额减少，写一条 consume 负额流水', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 500, version: 1 }],
    })
    const res = await deductCoin(db, { userId: 'u1', appId: 'app-b', amount: 50, bizId: 'B1', now: NOW })
    expect(res.balance).toBe(450)
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 450, version: 2 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      type: 'consume',
      amount: -50,
      balanceAfter: 450,
      appId: 'app-b',
      refId: 'B1',
    })
  })

  it('余额不足抛错且不产生流水', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 30, version: 1 }],
    })
    await expect(deductCoin(db, { userId: 'u1', appId: 'a', amount: 50, now: NOW })).rejects.toThrow(/余额不足/)
    expect(db._store[COIN_TX_COLLECTION] ?? []).toHaveLength(0)
    expect((await getWallet(db, 'u1')).balance).toBe(30)
  })

  it('无钱包视为余额不足', async () => {
    const db = makeFakeDb({})
    await expect(deductCoin(db, { userId: 'u1', appId: 'a', amount: 1, now: NOW })).rejects.toThrow(/余额不足/)
  })

  it('同 bizId 重复扣费幂等：只扣一次', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 500, version: 1 }],
    })
    await deductCoin(db, { userId: 'u1', appId: 'a', amount: 50, bizId: 'SAME', now: NOW })
    const res = await deductCoin(db, { userId: 'u1', appId: 'a', amount: 50, bizId: 'SAME', now: NOW })
    expect(res).toMatchObject({ balance: 450, deduped: true })
    expect(await getBalance(db, 'u1')).toBe(450)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })
})

describe('grantOrderEntitlement', () => {
  it('recharge_coin 订单：按 coinAmount 入账云币', async () => {
    const db = makeFakeDb({})
    const order = {
      userId: 'u1',
      appId: 'yunle',
      orderType: 'recharge_coin',
      coinAmount: 500,
      packId: 'coin_500',
      outTradeNo: 'YLF_RC',
    }
    const res = await grantOrderEntitlement(db, { order, now: NOW })
    expect(res.balance).toBe(500)
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({ type: 'recharge', amount: 500, refId: 'YLF_RC' })
  })

  it('membership 订单：开通会员（兼容 level 字段）', async () => {
    const db = makeFakeDb({})
    const order = {
      userId: 'u1',
      appId: 'yunle',
      orderType: 'membership',
      level: 'basic',
      billingCycle: 'month',
      outTradeNo: 'YLF_M',
    }
    await grantOrderEntitlement(db, { order, now: NOW })
    const m = db._store[MEMBERSHIPS_COLLECTION][0]
    expect(m).toMatchObject({ userId: 'u1', expireAt: NOW + 31 * DAY_MS })
  })

  it('无 orderType 的历史订单：按 membership 处理（用 planId）', async () => {
    const db = makeFakeDb({})
    const order = { userId: 'u1', planId: 'basic', billingCycle: 'year', outTradeNo: 'YLF_OLD' }
    await grantOrderEntitlement(db, { order, now: NOW })
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({ expireAt: NOW + 366 * DAY_MS })
  })

  it('recharge_coin 缺 coinAmount 抛错', async () => {
    const db = makeFakeDb({})
    const order = { userId: 'u1', appId: 'a', orderType: 'recharge_coin', outTradeNo: 'X' }
    await expect(grantOrderEntitlement(db, { order, now: NOW })).rejects.toThrow(/coinAmount/)
  })

  it('未知 orderType 抛错', async () => {
    const db = makeFakeDb({})
    const order = { userId: 'u1', orderType: 'weird', outTradeNo: 'X' }
    await expect(grantOrderEntitlement(db, { order, now: NOW })).rejects.toThrow(/未知 orderType/)
  })
})
