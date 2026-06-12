import { describe, expect, it } from 'vitest'

import {
  activateMembership,
  findOrderByOutTradeNo,
  markOrderPaid,
  MEMBERSHIPS_COLLECTION,
  ORDERS_COLLECTION,
} from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { DAY_MS } from '../../cloudfunctions/wxpay-order/lib/plans.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

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
    expect(r.expireAt).toBe(NOW + 31 * DAY_MS)
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1)
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      planId: 'basic',
      activeCycle: 'month',
      lastOrderId: 'YLFABC',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('已有未过期会员：累加到现有到期日', async () => {
    const existingExpire = NOW + 10 * DAY_MS
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'm1',
        userId: 'u1',
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
    expect(r.expireAt).toBe(existingExpire + 366 * DAY_MS)
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1) // 仍只有 1 条
    expect(db._store[MEMBERSHIPS_COLLECTION][0].activeCycle).toBe('year')
  })

  it('已过期会员：从 now 起累加', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'm1',
        userId: 'u1',
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
    expect(r.expireAt).toBe(NOW + 31 * DAY_MS)
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
        where() { return this },
        limit() { return this },
        async get() {
          return { data: [{ _id: 'm1', userId: 'u1', expireAt: currentExpire }] }
        },
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
    // 第二次读到并发写入后的 NOW+36d，再累加本单的 31d —— 没有覆盖别人的写入
    expect(r.expireAt).toBe(NOW + 36 * DAY_MS + 31 * DAY_MS)
  })

  it('新用户 insert 撞唯一索引时回退到 update', async () => {
    let doc = null
    let addCalls = 0
    const db = {
      collection: () => ({
        where() { return this },
        limit() { return this },
        async get() {
          return { data: doc ? [doc] : [] }
        },
        async add() {
          addCalls++
          // 并发 insert：本次 add 前已有别的请求插入了记录 → 撞唯一索引
          doc = { _id: 'm1', userId: 'u1', expireAt: NOW + 31 * DAY_MS }
          throw new Error('duplicate key error collection: user_memberships index: userId')
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
    // 回退 update：基于并发插入的 NOW+31d 再 +366d
    expect(r.expireAt).toBe(NOW + 31 * DAY_MS + 366 * DAY_MS)
  })

  it('持续冲突超过最大重试次数则抛错', async () => {
    const db = {
      collection: () => ({
        where() { return this },
        limit() { return this },
        async get() {
          return { data: [{ _id: 'm1', userId: 'u1', expireAt: NOW }] }
        },
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
