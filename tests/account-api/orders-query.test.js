import { describe, expect, it } from 'vitest'

import { listUserOrders, toOrderSummary } from '../../cloudfunctions/account-api/orders-query.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

function seed() {
  return {
    orders: [
      { _id: 'o1', userId: 'u1', outTradeNo: 'T1', orderType: 'membership', appId: 'yunle', amount: 1800, status: 'paid', level: 'basic', billingCycle: 'month', payType: 'JSAPI', createdAt: 100, updatedAt: 150, transactionId: 'wx-secret-1' },
      { _id: 'o2', userId: 'u1', outTradeNo: 'T2', orderType: 'recharge_coin', appId: 'yunle', amount: 1000, status: 'pending', coinAmount: 100, packId: 'p100', createdAt: 200, updatedAt: 200 },
      { _id: 'o3', userId: 'u2', outTradeNo: 'T3', orderType: 'membership', amount: 9900, status: 'paid', createdAt: 300, updatedAt: 300 },
    ],
  }
}

describe('account-api listUserOrders', () => {
  it('只返回当前用户订单，按 createdAt 倒序', async () => {
    const db = makeFakeDb(seed())
    const { items, nextSkip } = await listUserOrders(db, { userId: 'u1' })
    expect(items.map(i => i.id)).toEqual(['T2', 'T1'])
    expect(nextSkip).toBeNull()
  })

  it('分页返回 nextSkip（满页乐观给下一页，与 listTransactions 一致）', async () => {
    const db = makeFakeDb(seed())
    const page1 = await listUserOrders(db, { userId: 'u1', skip: 0, limit: 1 })
    expect(page1.items.map(i => i.id)).toEqual(['T2'])
    expect(page1.nextSkip).toBe(1)
    // 最后一满页仍乐观返回下一个 skip
    const page2 = await listUserOrders(db, { userId: 'u1', skip: 1, limit: 1 })
    expect(page2.items.map(i => i.id)).toEqual(['T1'])
    expect(page2.nextSkip).toBe(2)
    // 越界页为空，nextSkip 收敛为 null
    const page3 = await listUserOrders(db, { userId: 'u1', skip: 2, limit: 1 })
    expect(page3.items).toEqual([])
    expect(page3.nextSkip).toBeNull()
  })

  it('userId 必填', async () => {
    const db = makeFakeDb(seed())
    await expect(listUserOrders(db, { userId: '' })).rejects.toThrow(/userId/)
  })

  it('toOrderSummary 脱敏（剔除交易号）并兼容会员/充值字段', () => {
    const membership = toOrderSummary({ outTradeNo: 'T1', orderType: 'membership', amount: 1800, status: 'paid', level: 'basic', billingCycle: 'month', createdAt: 1, updatedAt: 2, transactionId: 'wx-secret' })
    expect(membership).not.toHaveProperty('transactionId')
    expect(membership.level).toBe('basic')
    expect(membership.paidAt).toBe(2)

    const recharge = toOrderSummary({ outTradeNo: 'T2', orderType: 'recharge_coin', amount: 1000, status: 'pending', coinAmount: 100, createdAt: 1, updatedAt: 1 })
    expect(recharge.coinAmount).toBe(100)
    expect(recharge.paidAt).toBeNull()
  })
})
