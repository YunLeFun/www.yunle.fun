/**
 * 微信支付回调端到端处理器测试
 *
 * 覆盖路径：
 *   - 验签失败（伪造签名 / 篡改 body / 未知证书 / 时钟漂移）
 *   - 业务字段不匹配（appid / mchid / 金额 / 订单不存在）
 *   - 状态机：pending -> paid -> 开通会员
 *   - 幂等：重放回调不重复开通
 *   - 异常事件（refund / trade_state != SUCCESS）
 */

import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'

import { handleNotify } from '../../cloudfunctions/wxpay-order/lib/notify-handler.js'
import { MEMBERSHIPS_COLLECTION, ORDERS_COLLECTION } from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { DAY_MS } from '../../cloudfunctions/wxpay-order/lib/plans.js'
import { makeCallbackEvent, makeFakeDb, makeKeyPair, signCallback } from '../_fixtures/wxpay.mjs'

const APPID = 'wxe6749827b67dfc25'
const MCHID = '1900000001'
const APIV3 = '12345678901234567890123456789012'
const SERIAL = 'CERT-001'
const OUT_TRADE_NO = 'YLF1700000000000abcdef0123456789'

function buildContext({ certificates, nowMs = Date.now() } = {}) {
  return {
    nowMs,
    timestamp: String(Math.floor(nowMs / 1000)),
    db: makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'order-1',
        outTradeNo: OUT_TRADE_NO,
        userId: 'user-1',
        planId: 'basic',
        billingCycle: 'month',
        amount: 990,
        status: 'pending',
        createdAt: nowMs - 1000,
        updatedAt: nowMs - 1000,
      }],
      [MEMBERSHIPS_COLLECTION]: [],
    }),
    config: {
      apiV3Key: APIV3,
      expectedAppid: APPID,
      expectedMchid: MCHID,
      certificates,
      toleranceSeconds: 300,
      now: () => nowMs,
    },
  }
}

function buildResource({ overrides } = {}) {
  return {
    mchid: MCHID,
    appid: APPID,
    out_trade_no: OUT_TRADE_NO,
    transaction_id: '4200000000000000000000',
    trade_type: 'NATIVE',
    trade_state: 'SUCCESS',
    trade_state_desc: '支付成功',
    bank_type: 'CMC',
    attach: '',
    success_time: '2023-11-14T10:00:00+08:00',
    amount: { total: 990, payer_total: 990, currency: 'CNY', payer_currency: 'CNY' },
    ...overrides,
  }
}

function findMembership(db, userId) {
  const rows = db._store[MEMBERSHIPS_COLLECTION] || []
  return rows.find(item => item._id === userId) || rows.find(item => item.userId === userId)
}

let keyPair
beforeEach(() => {
  keyPair = makeKeyPair()
})

describe('handleNotify — 成功路径', () => {
  it('合法回调：标记 paid + 开通会员 + 返回 200 SUCCESS', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ code: 'SUCCESS' })

    const order = db._store[ORDERS_COLLECTION][0]
    expect(order.status).toBe('paid')
    expect(order.transactionId).toBe('4200000000000000000000')

    const ms = db._store[MEMBERSHIPS_COLLECTION]
    expect(ms).toHaveLength(1)
    expect(ms[0]).toMatchObject({
      userId: 'user-1',
      planId: 'basic',
      activeCycle: 'month',
    })
    expect(ms[0].expireAt).toBe(config.now() + 31 * DAY_MS)
  })

  it('幂等：第二次回调不会双倍开通会员', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event1 = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp,
    })
    await handleNotify({ event: event1, db, config })
    const expireAfter1 = db._store[MEMBERSHIPS_COLLECTION][0].expireAt

    const event2 = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp,
    })
    const res = await handleNotify({ event: event2, db, config })
    expect(res.statusCode).toBe(200)

    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(expireAfter1)
  })
})

describe('handleNotify — 验签失败', () => {
  it('未知 serial：401 FAIL，订单状态不变', async () => {
    const { db, config } = buildContext({ certificates: { OTHER_SERIAL: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(0)
  })

  it('伪造签名：401 FAIL', async () => {
    const { db, config } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
    })
    event.headers['Wechatpay-Signature'] = crypto.randomBytes(256).toString('base64')

    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(0)
  })

  it('body 被篡改：签名不再匹配 → 401', async () => {
    const { db, config } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
    })
    event.body = `${event.body} `

    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
  })

  it('时钟漂移超出容忍区间：401', async () => {
    const { db, config } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const oldTs = String(Math.floor((Date.now() - 24 * 3600 * 1000) / 1000))
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp: oldTs,
    })
    const res = await handleNotify({
      event,
      db,
      config: { ...config, toleranceSeconds: 300, now: () => Date.now() },
    })
    expect(res.statusCode).toBe(401)
  })

  it('缺失签名 header：401', async () => {
    const { db, config } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
    })
    delete event.headers['Wechatpay-Signature']
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
  })
})

describe('handleNotify — 业务字段校验', () => {
  it('金额被篡改：401 FAIL，订单不变', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({ overrides: { amount: { total: 1, currency: 'CNY' } } }),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).message).toMatch(/金额不匹配/)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
  })

  it('appid 不匹配：401', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({ overrides: { appid: 'wx-attacker' } }),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
  })

  it('mchid 不匹配：401', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({ overrides: { mchid: 'mch-attacker' } }),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
  })

  it('订单不存在：200 SUCCESS（不让微信重试），无开通', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({ overrides: { out_trade_no: 'YLF_NOT_EXIST_999999999' } }),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
    expect(db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(0)
  })
})

describe('handleNotify — 非支付成功事件', () => {
  it('event_type=REFUND.SUCCESS：200 但不动订单', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      eventType: 'REFUND.SUCCESS',
      resourcePlaintext: buildResource(),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
  })

  it('trade_state=USERPAYING：200 但不开通', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({ overrides: { trade_state: 'USERPAYING' } }),
      timestamp,
    })
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
  })
})

describe('handleNotify — 解密失败', () => {
  it('aPIv3 Key 错误：500 FAIL', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp,
    })
    config.apiV3Key = '00000000000000000000000000000000'
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(500)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('pending')
  })
})

describe('handleNotify — 续费场景', () => {
  it('已有未过期会员：累加而非覆盖', async () => {
    const NOW = Date.now()
    const existing = NOW + 5 * DAY_MS

    const db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'order-2',
        outTradeNo: OUT_TRADE_NO,
        userId: 'user-1',
        planId: 'basic',
        billingCycle: 'year',
        amount: 9990,
        status: 'pending',
      }],
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'm-1',
        userId: 'user-1',
        planId: 'basic',
        activeCycle: 'month',
        expireAt: existing,
      }],
    })
    const config = {
      apiV3Key: APIV3,
      expectedAppid: APPID,
      expectedMchid: MCHID,
      certificates: { [SERIAL]: keyPair.publicKey },
      toleranceSeconds: 300,
      now: () => NOW,
    }
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource({
        overrides: { amount: { total: 9990, currency: 'CNY' } },
      }),
      timestamp: String(Math.floor(NOW / 1000)),
    })

    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
    const membership = findMembership(db, 'user-1')
    expect(membership.expireAt).toBe(existing + 366 * DAY_MS)
    expect(membership.activeCycle).toBe('year')
  })
})

describe('handleNotify — header 大小写鲁棒性', () => {
  it('header 大小写混合也能正确读取', async () => {
    const { db, config, timestamp } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const event = makeCallbackEvent({
      apiV3Key: APIV3,
      privateKey: keyPair.privateKey,
      serial: SERIAL,
      resourcePlaintext: buildResource(),
      timestamp,
    })
    // 把 header 名字改成全大写
    const upper = {}
    for (const [k, v] of Object.entries(event.headers))
      upper[k.toUpperCase()] = v
    event.headers = upper

    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(200)
  })
})

describe('handleNotify — 签名复用边界', () => {
  it('使用相同 timestamp/nonce 但篡改 body 仍被拒绝', async () => {
    const { db, config } = buildContext({ certificates: { [SERIAL]: keyPair.publicKey } })
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'fixed-nonce'
    const validBody = '{"event_type":"TRANSACTION.SUCCESS"}'
    const signature = signCallback({ privateKey: keyPair.privateKey, timestamp: ts, nonce, body: validBody })
    const event = {
      httpMethod: 'POST',
      headers: {
        'Wechatpay-Timestamp': ts,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Signature': signature,
        'Wechatpay-Serial': SERIAL,
      },
      body: '{"event_type":"TRANSACTION.SUCCESS","x":1}', // 偷偷改 body
    }
    const res = await handleNotify({ event, db, config })
    expect(res.statusCode).toBe(401)
  })
})
