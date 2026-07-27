import { describe, expect, it } from 'vitest'

import { computeNewExpireAt } from '../../cloudfunctions/wxpay-order/lib/membership.js'
import {
  activateMembership,
  findOrderByOutTradeNo,
  grantOrderEntitlement,
  markOrderGranted,
  markOrderPaid,
  MEMBERSHIPS_COLLECTION,
  ORDERS_COLLECTION,
  readMembership,
} from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { DAY_MS } from '../../cloudfunctions/wxpay-order/lib/plans.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function shanghai(value) {
  return Date.parse(`${value}+08:00`)
}

describe('findOrderByOutTradeNo', () => {
  it('找到返回对象副本', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{ _id: 'a', outTradeNo: 'X', status: 'pending', amount: 990 }],
    })
    expect(await findOrderByOutTradeNo(db, 'X')).toMatchObject({ outTradeNo: 'X', amount: 990 })
  })

  it('找不到返回 null', async () => {
    const db = makeFakeDb({ [ORDERS_COLLECTION]: [] })
    expect(await findOrderByOutTradeNo(db, 'X')).toBeNull()
  })
})

describe('markOrderPaid', () => {
  it('首次更新 updated=1', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{ _id: 'a', outTradeNo: 'X', status: 'pending', amount: 990 }],
    })
    const { updated } = await markOrderPaid(db, { outTradeNo: 'X', transactionId: 'tx', now: NOW })
    expect(updated).toBe(1)
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'paid',
      transactionId: 'tx',
      paidAt: NOW,
    })
  })

  it('已 paid 时再次更新 updated=0（幂等）', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{ _id: 'a', outTradeNo: 'X', status: 'paid', amount: 990, transactionId: 'old' }],
    })
    const { updated } = await markOrderPaid(db, { outTradeNo: 'X', transactionId: 'tx-new', now: NOW })
    expect(updated).toBe(0)
    expect(db._store[ORDERS_COLLECTION][0].transactionId).toBe('old')
  })

  it('订单不存在 updated=0', async () => {
    const db = makeFakeDb({ [ORDERS_COLLECTION]: [] })
    const { updated } = await markOrderPaid(db, { outTradeNo: 'X', transactionId: 't', now: NOW })
    expect(updated).toBe(0)
  })
})

describe('activateMembership', () => {
  it('首次开通月付：插入新记录', async () => {
    const db = makeFakeDb({ [MEMBERSHIPS_COLLECTION]: [] })
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLFABC',
    })
    expect(r.expireAt).toBe(computeNewExpireAt({ current: null, cycle: 'month', now: NOW }))
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1)
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({
      _id: 'u1',
      planId: 'basic',
      activeCycle: 'month',
      billingAnchorDay: 15,
      lastOrderId: 'YLFABC',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).not.toHaveProperty('userId')
  })

  it('已有未过期会员：累加到现有到期日', async () => {
    const existingExpire = NOW + 10 * DAY_MS
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: existingExpire,
        createdAt: NOW - 10 * DAY_MS,
        updatedAt: NOW - 10 * DAY_MS,
      }],
    })
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'year',
      now: NOW,
      outTradeNo: 'YLF2',
    })
    expect(r.expireAt).toBe(computeNewExpireAt({ current: existingExpire, cycle: 'year', now: NOW }))
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1) // 仍只有 1 条
    expect(db._store[MEMBERSHIPS_COLLECTION][0].activeCycle).toBe('year')
  })

  it('已过期会员：从 now 起累加', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: NOW - 5 * DAY_MS,
      }],
    })
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLF3',
    })
    expect(r.expireAt).toBe(computeNewExpireAt({ current: null, cycle: 'month', now: NOW }))
  })

  it('月末连续续费：持久化原账单日并在后续月份恢复', async () => {
    const jan31 = shanghai('2026-01-31T00:30:00.000')
    const db = makeFakeDb({ [MEMBERSHIPS_COLLECTION]: [] })

    const first = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: jan31,
      outTradeNo: 'YLF-JAN',
    })
    const second = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: shanghai('2026-02-01T00:00:00.000'),
      outTradeNo: 'YLF-FEB',
    })

    expect(first).toMatchObject({
      expireAt: shanghai('2026-02-28T00:30:00.000'),
      billingAnchorDay: 31,
    })
    expect(second).toMatchObject({
      expireAt: shanghai('2026-03-31T00:30:00.000'),
      billingAnchorDay: 31,
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({
      expireAt: second.expireAt,
      billingAnchorDay: 31,
      lastOrderId: 'YLF-FEB',
    })
  })

  it('非月末锚点落入二月月末后，下一期仍恢复原日号', async () => {
    const jan30 = shanghai('2026-01-30T10:00:00.000')
    const db = makeFakeDb({ [MEMBERSHIPS_COLLECTION]: [] })

    const first = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: jan30,
      outTradeNo: 'YLF-JAN30',
    })
    const second = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: shanghai('2026-02-01T00:00:00.000'),
      outTradeNo: 'YLF-FEB30',
    })

    expect(first.expireAt).toBe(shanghai('2026-02-28T10:00:00.000'))
    expect(second).toMatchObject({
      expireAt: shanghai('2026-03-30T10:00:00.000'),
      billingAnchorDay: 30,
      billingAnchorIsMonthEnd: false,
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0].billingAnchorIsMonthEnd).toBe(false)
  })

  it('只按 uid 主键读取会员，不依赖冗余 userId 字段', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: NOW + 12 * DAY_MS,
      }],
    })

    expect(await readMembership(db, 'u1')).toMatchObject({ _id: 'u1' })
    expect(await readMembership(db, 'missing')).toBeNull()
  })

  it('userId 缺失抛错', async () => {
    const db = makeFakeDb()
    await expect(activateMembership(db, {
      userId: '',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'X',
    })).rejects.toThrow(/userId/)
  })
})

describe('activateMembership — 并发安全（CAS 重试）', () => {
  it('乐观锁冲突时重试，且不丢失并发写入的时长', async () => {
    // 模拟：第一次 CAS 失败（并发写入把 expireAt 推进了），第二次基于最新值成功
    let currentExpire = NOW + 5 * DAY_MS
    let updateCalls = 0
    const db = {
      collection: () => ({
        doc() {
          return {
            get: async () => ({ data: [{ _id: 'u1', expireAt: currentExpire }] }),
          }
        },
        where() { return this },
        async update(payload) {
          updateCalls++
          if (updateCalls === 1) {
            // 并发写入：别人先 +1 个月，本次 CAS 条件已失效
            currentExpire = NOW + 36 * DAY_MS
            return { updated: 0 }
          }
          currentExpire = payload.expireAt
          return { updated: 1 }
        },
      }),
    }
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLF9',
    })
    expect(updateCalls).toBe(2)
    // 第二次读到并发写入后的到期日，再顺延一个自然月 —— 没有覆盖别人的写入
    expect(r.expireAt).toBe(computeNewExpireAt({
      current: NOW + 36 * DAY_MS,
      cycle: 'month',
      now: NOW,
    }))
  })

  it('新用户 insert 撞 _id 主键时回退到 update', async () => {
    let doc = null
    let addCalls = 0
    const db = {
      collection: () => ({
        doc() {
          return {
            get: async () => ({ data: doc ? [doc] : [] }),
          }
        },
        where() { return this },
        async add() {
          addCalls++
          // 并发 insert：本次 add 前已有别的请求插入了记录 → 撞 `_id` 主键
          doc = { _id: 'u1', expireAt: NOW + 31 * DAY_MS }
          throw new Error('duplicate key error collection: user_memberships index: _id_')
        },
        async update(payload) {
          doc = { ...doc, ...payload }
          return { updated: 1 }
        },
      }),
    }
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'year',
      now: NOW,
      outTradeNo: 'YLF10',
    })
    expect(addCalls).toBe(1)
    // 回退 update：基于并发插入的到期日再顺延一个自然年
    expect(r.expireAt).toBe(computeNewExpireAt({
      current: NOW + 31 * DAY_MS,
      cycle: 'year',
      now: NOW,
    }))
  })

  it('持续冲突超过最大重试次数则抛错', async () => {
    const db = {
      collection: () => ({
        doc() {
          return {
            get: async () => ({ data: [{ _id: 'u1', expireAt: NOW }] }),
          }
        },
        where() { return this },
        async update() {
          return { updated: 0 } // 永远 CAS 失败
        },
      }),
    }
    await expect(activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLFX',
    })).rejects.toThrow(/并发重试/)
  })
})

describe('activateMembership — 订单幂等（lastOrderId）', () => {
  it('同一订单重复开通：lastOrderId 命中则不重复累加时长', async () => {
    const existingExpire = NOW + 20 * DAY_MS
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: existingExpire,
        lastOrderId: 'YLF-SAME',
      }],
    })
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLF-SAME', // 与已记录的 lastOrderId 相同 → 视为已开通，不累加
    })
    expect(r.expireAt).toBe(existingExpire)
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(existingExpire)
  })

  it('不同订单仍正常累加（lastOrderId 不同）', async () => {
    const existingExpire = NOW + 20 * DAY_MS
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: existingExpire,
        lastOrderId: 'YLF-OLD',
      }],
    })
    const r = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: NOW,
      outTradeNo: 'YLF-NEW',
    })
    expect(r.expireAt).toBe(computeNewExpireAt({ current: existingExpire, cycle: 'month', now: NOW }))
  })
})

describe('grantOrderEntitlement — 幂等与 grantedAt 回写', () => {
  it('order.grantedAt 已存在：跳过发放', async () => {
    const db = makeFakeDb({ [MEMBERSHIPS_COLLECTION]: [] })
    const r = await grantOrderEntitlement(db, {
      order: {
        outTradeNo: 'YLF1',
        userId: 'u1',
        orderType: 'membership',
        level: 'basic',
        billingCycle: 'month',
        grantedAt: NOW - 1,
      },
      now: NOW,
    })
    expect(r).toEqual({ alreadyGranted: true })
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(0)
  })

  it('会员订单发放成功后回写 grantedAt 到订单', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'o1',
        outTradeNo: 'YLF2',
        userId: 'u1',
        orderType: 'membership',
        level: 'basic',
        billingCycle: 'month',
        status: 'paid',
      }],
      [MEMBERSHIPS_COLLECTION]: [],
    })
    await grantOrderEntitlement(db, { order: db._store[ORDERS_COLLECTION][0], now: NOW })
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1)
    expect(db._store[ORDERS_COLLECTION][0].grantedAt).toBe(NOW)
  })

  it('对账补发 IAP 会员时按 Apple 购买时间起算，而不按处理时间起算', async () => {
    const providerPurchasedAt = shanghai('2026-01-31T23:59:00.000')
    const reconciledAt = shanghai('2026-02-02T12:00:00.000')
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'iap-o1',
        outTradeNo: 'iap_30001',
        userId: 'u1',
        orderType: 'membership',
        payType: 'iap',
        level: 'basic',
        billingCycle: 'month',
        providerPurchasedAt,
        status: 'paid',
      }],
      [MEMBERSHIPS_COLLECTION]: [],
    })

    await grantOrderEntitlement(db, {
      order: db._store[ORDERS_COLLECTION][0],
      now: reconciledAt,
    })

    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt)
      .toBe(shanghai('2026-02-28T23:59:00.000'))
  })

  it('对账重入（订单已带 grantedAt）不重复续期', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'o1',
        outTradeNo: 'YLF3',
        userId: 'u1',
        orderType: 'membership',
        level: 'basic',
        billingCycle: 'month',
        status: 'paid',
      }],
      [MEMBERSHIPS_COLLECTION]: [],
    })
    await grantOrderEntitlement(db, { order: db._store[ORDERS_COLLECTION][0], now: NOW })
    const expireAfter1 = db._store[MEMBERSHIPS_COLLECTION][0].expireAt
    const r2 = await grantOrderEntitlement(db, { order: db._store[ORDERS_COLLECTION][0], now: NOW + 5 * DAY_MS })
    expect(r2).toEqual({ alreadyGranted: true })
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(expireAfter1)
  })

  it('grantedAt 回写丢失时，底层 lastOrderId 幂等仍防重复续期', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'o1',
        outTradeNo: 'YLF4',
        userId: 'u1',
        orderType: 'membership',
        level: 'basic',
        billingCycle: 'month',
        status: 'paid',
      }],
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: NOW + 31 * DAY_MS,
        lastOrderId: 'YLF4',
      }],
    })
    const r = await grantOrderEntitlement(db, {
      order: db._store[ORDERS_COLLECTION][0], // 与 lastOrderId 相同；注意无 grantedAt（模拟回写丢失 / 对账重入）
      now: NOW + 10 * DAY_MS,
    })
    expect(r.expireAt).toBe(NOW + 31 * DAY_MS)
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(NOW + 31 * DAY_MS)
    expect(db._store[ORDERS_COLLECTION][0].membershipGrant).toBeUndefined()
  })
})

describe('markOrderGranted', () => {
  it('写入 grantedAt 并返回 updated=1', async () => {
    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{ _id: 'o1', outTradeNo: 'X', status: 'paid' }],
    })
    const { updated } = await markOrderGranted(db, { outTradeNo: 'X', now: NOW })
    expect(updated).toBe(1)
    expect(db._store[ORDERS_COLLECTION][0].grantedAt).toBe(NOW)
  })
})
