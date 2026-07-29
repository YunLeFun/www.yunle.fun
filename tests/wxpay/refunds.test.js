import { describe, expect, it, vi } from 'vitest'

import { MEMBERSHIPS_COLLECTION, ORDERS_COLLECTION } from '../../cloudfunctions/wxpay-order/lib/orders.js'
import {
  queryMembershipRefundForAdmin,
  requestMembershipRefundForAdmin,
} from '../../cloudfunctions/wxpay-order/lib/refund-service.js'
import {
  applyWechatRefundResult,
  buildOutRefundNo,
  prepareMembershipRefund,
} from '../../cloudfunctions/wxpay-order/lib/refunds.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_800_000_000_000
const OUT_TRADE_NO = 'YLF1800000000000abcdef0123456789'

function membershipOrder(overrides = {}) {
  const expireBefore = NOW + 10 * 24 * 60 * 60 * 1000
  const expireAfter = NOW + 40 * 24 * 60 * 60 * 1000
  return {
    _id: 'order-1',
    outTradeNo: OUT_TRADE_NO,
    userId: 'u1',
    orderType: 'membership',
    payType: 'native',
    status: 'paid',
    amount: 990,
    paidAt: NOW - 24 * 60 * 60 * 1000,
    grantedAt: NOW - 24 * 60 * 60 * 1000,
    membershipGrant: {
      expireBefore,
      expireAfter,
      billingAnchorDayBefore: 15,
      billingAnchorIsMonthEndBefore: false,
      activeCycleBefore: 'month',
      planIdBefore: 'basic',
      levelBefore: 'basic',
      lastOrderIdBefore: 'previous-order',
    },
    createdAt: NOW - 24 * 60 * 60 * 1000,
    updatedAt: NOW - 24 * 60 * 60 * 1000,
    ...overrides,
  }
}

function membershipFor(order = membershipOrder(), overrides = {}) {
  return {
    _id: order.userId,
    planId: 'basic',
    level: 'basic',
    activeCycle: 'month',
    expireAt: order.membershipGrant.expireAfter,
    lastOrderId: order.outTradeNo,
    updatedAt: order.grantedAt,
    ...overrides,
  }
}

function makeRefundDb(orderOverrides = {}, membershipOverrides = {}) {
  const order = membershipOrder(orderOverrides)
  return makeFakeDb({
    [ORDERS_COLLECTION]: [order],
    [MEMBERSHIPS_COLLECTION]: [membershipFor(order, membershipOverrides)],
  })
}

function requestInput(extra = {}) {
  return {
    outTradeNo: OUT_TRADE_NO,
    operator: 'owner-login',
    reason: '用户在购买后 7 天内申请全额退款',
    now: NOW,
    ...extra,
  }
}

function config() {
  return {
    appId: 'wx-app',
    mchId: '1900000001',
    serialNo: 'serial',
    privateKey: 'private-key',
    refundNotifyUrl: 'https://example.com/wxpay-notify',
  }
}

describe('微信会员退款状态机', () => {
  it('稳定派生商户退款单号', () => {
    expect(buildOutRefundNo(OUT_TRADE_NO)).toBe(buildOutRefundNo(OUT_TRADE_NO))
    expect(buildOutRefundNo(OUT_TRADE_NO)).toMatch(/^YLFREF[a-f0-9]{40}$/)
  })

  it('先持久化退款意图，并且重复请求幂等', async () => {
    const db = makeRefundDb()
    const first = await prepareMembershipRefund(db, requestInput())
    const second = await prepareMembershipRefund(db, requestInput({ reason: '不同原因不会覆盖首次审计' }))

    expect(first.deduped).toBe(false)
    expect(second.deduped).toBe(true)
    expect(db._store[ORDERS_COLLECTION][0].refund).toMatchObject({
      status: 'REQUESTED',
      requestedBy: 'owner-login',
      reason: '用户在购买后 7 天内申请全额退款',
      amount: 990,
    })
  })

  it('拒绝超过 7 天、IAP 和非会员订单', async () => {
    await expect(prepareMembershipRefund(
      makeRefundDb({ paidAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
      requestInput(),
    )).rejects.toThrow(/超过购买后 7 天/)

    await expect(prepareMembershipRefund(
      makeRefundDb({ payType: 'iap' }),
      requestInput(),
    )).rejects.toThrow(/Apple/)

    await expect(prepareMembershipRefund(
      makeRefundDb({ orderType: 'recharge_coin' }),
      requestInput(),
    )).rejects.toThrow(/仅支持会员订单/)
  })

  it('processing 只更新退款态，不提前撤销会员', async () => {
    const db = makeRefundDb()
    await prepareMembershipRefund(db, requestInput())
    const before = db._store[MEMBERSHIPS_COLLECTION][0].expireAt

    const result = await applyWechatRefundResult(db, {
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
      refundId: '50000000001',
      status: 'PROCESSING',
      now: NOW + 1,
    })

    expect(result.status).toBe('PROCESSING')
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('paid')
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(before)
  })

  it('success 标记已退款并只回滚该订单增加的会员周期', async () => {
    const db = makeRefundDb()
    const order = db._store[ORDERS_COLLECTION][0]
    await prepareMembershipRefund(db, requestInput())

    const result = await applyWechatRefundResult(db, {
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
      refundId: '50000000001',
      status: 'SUCCESS',
      successTime: '2027-01-15T10:00:00+08:00',
      now: NOW + 1,
    })

    expect(result).toMatchObject({
      status: 'SUCCESS',
      entitlementStatus: 'reverted',
      entitlementReverted: true,
    })
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'refunded',
      refundStatus: 'SUCCESS',
      refundEntitlementStatus: 'reverted',
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({
      expireAt: order.membershipGrant.expireBefore,
      lastOrderId: 'previous-order',
    })
  })

  it('success 后迟到的 processing 回调不会倒退退款状态或重复回滚', async () => {
    const db = makeRefundDb()
    await prepareMembershipRefund(db, requestInput())
    await applyWechatRefundResult(db, {
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
      status: 'SUCCESS',
      now: NOW + 1,
    })
    const expireAt = db._store[MEMBERSHIPS_COLLECTION][0].expireAt

    const result = await applyWechatRefundResult(db, {
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
      status: 'PROCESSING',
      now: NOW + 2,
    })

    expect(result).toMatchObject({
      status: 'SUCCESS',
      entitlementStatus: 'reverted',
      deduped: true,
    })
    expect(db._store[ORDERS_COLLECTION][0].refundStatus).toBe('SUCCESS')
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(expireAt)
  })

  it('并发的 success 与 processing 状态推进最终保持成功', async () => {
    const db = makeRefundDb()
    await prepareMembershipRefund(db, requestInput())

    const [success, processing] = await Promise.all([
      applyWechatRefundResult(db, {
        outTradeNo: OUT_TRADE_NO,
        outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
        status: 'SUCCESS',
        now: NOW + 1,
      }),
      applyWechatRefundResult(db, {
        outTradeNo: OUT_TRADE_NO,
        outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
        status: 'PROCESSING',
        now: NOW + 2,
      }),
    ])

    expect([success.status, processing.status]).toContain('SUCCESS')
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'refunded',
      refundStatus: 'SUCCESS',
      refundEntitlementStatus: 'reverted',
    })
  })

  it('会员已有后续变更时保留当前权益并进入人工复核', async () => {
    const db = makeRefundDb({}, {
      expireAt: NOW + 70 * 24 * 60 * 60 * 1000,
      lastOrderId: 'later-order',
    })
    const before = db._store[MEMBERSHIPS_COLLECTION][0].expireAt
    await prepareMembershipRefund(db, requestInput())

    const result = await applyWechatRefundResult(db, {
      outTradeNo: OUT_TRADE_NO,
      outRefundNo: buildOutRefundNo(OUT_TRADE_NO),
      status: 'SUCCESS',
      now: NOW + 1,
    })

    expect(result).toMatchObject({
      entitlementStatus: 'manual_review_required',
      manualReviewRequired: true,
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(before)
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('refunded')
  })
})

describe('微信会员退款编排', () => {
  it('先查原支付订单，再使用完整金额和稳定退款单号申请退款', async () => {
    const db = makeRefundDb()
    const queryTransaction = vi.fn().mockResolvedValue({
      appid: 'wx-app',
      mchid: '1900000001',
      out_trade_no: OUT_TRADE_NO,
      trade_state: 'SUCCESS',
      amount: { total: 990 },
    })
    const requestRefund = vi.fn().mockResolvedValue({
      out_trade_no: OUT_TRADE_NO,
      out_refund_no: buildOutRefundNo(OUT_TRADE_NO),
      refund_id: '50000000001',
      status: 'PROCESSING',
      amount: { refund: 990, total: 990 },
    })

    const result = await requestMembershipRefundForAdmin(db, {
      ...requestInput(),
      config: config(),
    }, { queryTransaction, requestRefund })

    expect(result.status).toBe('PROCESSING')
    expect(queryTransaction).toHaveBeenCalledOnce()
    expect(requestRefund).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      out_trade_no: OUT_TRADE_NO,
      out_refund_no: buildOutRefundNo(OUT_TRADE_NO),
      notify_url: 'https://example.com/wxpay-notify',
      amount: { refund: 990, total: 990, currency: 'CNY' },
    }))
  })

  it('申请失败保留可重试状态和错误，不改订单与会员', async () => {
    const db = makeRefundDb()
    const requestRefund = vi.fn().mockRejectedValue(new Error('微信余额不足'))

    await expect(requestMembershipRefundForAdmin(db, {
      ...requestInput(),
      config: config(),
    }, {
      queryTransaction: vi.fn().mockResolvedValue({
        appid: 'wx-app',
        mchid: '1900000001',
        out_trade_no: OUT_TRADE_NO,
        trade_state: 'SUCCESS',
        amount: { total: 990 },
      }),
      requestRefund,
    })).rejects.toThrow(/余额不足/)

    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'paid',
      refundStatus: 'REQUEST_FAILED',
    })
    expect(db._store[ORDERS_COLLECTION][0].refund.lastError).toContain('余额不足')
  })

  it('退款 POST 响应中断时主动查单并应用渠道结果', async () => {
    const db = makeRefundDb()
    const queryRefund = vi.fn().mockResolvedValue({
      out_trade_no: OUT_TRADE_NO,
      out_refund_no: buildOutRefundNo(OUT_TRADE_NO),
      refund_id: '50000000001',
      status: 'PROCESSING',
      amount: { refund: 990, total: 990 },
    })

    const result = await requestMembershipRefundForAdmin(db, {
      ...requestInput(),
      config: config(),
    }, {
      queryTransaction: vi.fn().mockResolvedValue({
        appid: 'wx-app',
        mchid: '1900000001',
        out_trade_no: OUT_TRADE_NO,
        trade_state: 'SUCCESS',
        amount: { total: 990 },
      }),
      requestRefund: vi.fn().mockRejectedValue(new TypeError('terminated')),
      queryRefund,
    })

    expect(queryRefund).toHaveBeenCalledWith(
      expect.any(Object),
      buildOutRefundNo(OUT_TRADE_NO),
    )
    expect(result).toMatchObject({
      status: 'PROCESSING',
      entitlementStatus: 'pending',
    })
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'paid',
      refundStatus: 'PROCESSING',
    })
  })

  it('退款 POST 响应中断且暂时查不到时保持待确认，不误报申请失败', async () => {
    const db = makeRefundDb()

    const result = await requestMembershipRefundForAdmin(db, {
      ...requestInput(),
      config: config(),
    }, {
      queryTransaction: vi.fn().mockResolvedValue({
        appid: 'wx-app',
        mchid: '1900000001',
        out_trade_no: OUT_TRADE_NO,
        trade_state: 'SUCCESS',
        amount: { total: 990 },
      }),
      requestRefund: vi.fn().mockRejectedValue(new TypeError('terminated')),
      queryRefund: vi.fn().mockRejectedValue(new Error('退款单不存在')),
    })

    expect(result).toMatchObject({
      status: 'REQUESTED',
      entitlementStatus: 'pending',
      reconciliationPending: true,
    })
    expect(result.lastError).toContain('渠道结果待确认')
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'paid',
      refundStatus: 'REQUESTED',
    })
    expect(db._store[ORDERS_COLLECTION][0].refund.lastError).toContain('渠道结果待确认')
  })

  it('主动查询 SUCCESS 会补偿完成订单和权益回滚', async () => {
    const db = makeRefundDb()
    await prepareMembershipRefund(db, requestInput())

    const result = await queryMembershipRefundForAdmin(db, {
      outTradeNo: OUT_TRADE_NO,
      config: config(),
      now: NOW + 2,
    }, {
      queryRefund: vi.fn().mockResolvedValue({
        out_trade_no: OUT_TRADE_NO,
        out_refund_no: buildOutRefundNo(OUT_TRADE_NO),
        refund_id: '50000000001',
        status: 'SUCCESS',
        amount: { refund: 990, total: 990 },
      }),
    })

    expect(result.entitlementStatus).toBe('reverted')
    expect(db._store[ORDERS_COLLECTION][0].status).toBe('refunded')
  })
})
