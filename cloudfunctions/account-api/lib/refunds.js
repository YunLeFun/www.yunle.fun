/**
 * 微信会员退款状态机。
 *
 * 退款申请由 wxpay-order 发起，结果可由主动查单或 wxpay-notify 回调推进。
 * 只有微信明确返回 SUCCESS 后才把订单标为 refunded，并按会员发放快照安全回滚。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const crypto = require('node:crypto')

const { resolveBillingAnchor } = require('./membership')
const {
  findOrderByOutTradeNo,
  MEMBERSHIPS_COLLECTION,
  ORDERS_COLLECTION,
  readMembership,
} = require('./orders')

const MEMBERSHIP_REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const WECHAT_REFUND_STATUSES = new Set(['PROCESSING', 'SUCCESS', 'CLOSED', 'ABNORMAL'])
const REFUND_REASON_MAX_LENGTH = 80
const REFUND_AUDIT_EVENT_LIMIT = 20

function affectedCount(result) {
  return result?.updated ?? result?.modifiedCount ?? 0
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} 必须为非空字符串`)
  return value.trim()
}

function buildOutRefundNo(outTradeNo) {
  const normalized = assertNonEmptyString(outTradeNo, 'outTradeNo')
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 40)
  return `YLFREF${digest}`
}

function appendAuditEvent(refund, event) {
  const current = Array.isArray(refund?.audit) ? refund.audit : []
  return [...current, event].slice(-REFUND_AUDIT_EVENT_LIMIT)
}

function refundResult(order, extra = {}) {
  const refund = order?.refund || {}
  return {
    outTradeNo: order?.outTradeNo || '',
    outRefundNo: refund.outRefundNo || '',
    status: refund.status || '',
    refundId: refund.refundId || '',
    entitlementStatus: refund.entitlementStatus || order?.refundEntitlementStatus || 'pending',
    amount: refund.amount ?? order?.amount ?? 0,
    requestedAt: refund.requestedAt || null,
    updatedAt: refund.updatedAt || order?.updatedAt || null,
    lastError: refund.lastError || '',
    ...extra,
  }
}

async function writeRefundState(db, order, refund, updates = {}) {
  const result = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo: order.outTradeNo })
    .update({
      ...updates,
      refund,
      refundStatus: refund.status,
      updatedAt: refund.updatedAt,
    })
  if (affectedCount(result) === 0)
    throw new Error(`退款订单更新失败: ${order.outTradeNo}`)
  return { ...order, ...updates, refund, refundStatus: refund.status, updatedAt: refund.updatedAt }
}

function assertRefundEligibility(order, now) {
  if (!order)
    throw new Error('订单不存在')
  if ((order.orderType || 'membership') !== 'membership')
    throw new Error('仅支持会员订单退款')
  if (order.payType === 'iap')
    throw new Error('App Store 订单需由用户向 Apple 申请退款')
  if (!['native', 'jsapi', 'h5'].includes(order.payType))
    throw new Error(`不支持的支付渠道: ${order.payType || 'unknown'}`)
  if (order.status !== 'paid')
    throw new Error('仅已支付订单可发起退款')
  if (!Number.isInteger(order.amount) || order.amount <= 0)
    throw new Error('订单金额无效')
  if (!Number.isFinite(order.paidAt))
    throw new Error('订单缺少支付时间，需人工复核')
  if (now < order.paidAt || now - order.paidAt > MEMBERSHIP_REFUND_WINDOW_MS)
    throw new Error('订单已超过购买后 7 天全额退款期限')
}

function normalizeRefundReason(reason) {
  const normalized = assertNonEmptyString(reason, '退款原因')
  if (normalized.length > REFUND_REASON_MAX_LENGTH)
    throw new Error(`退款原因不得超过 ${REFUND_REASON_MAX_LENGTH} 个字符`)
  return normalized
}

/**
 * 创建退款意图。意图先持久化，再调用微信，保证任何外部资金动作都有操作人与原因可追溯。
 */
async function prepareMembershipRefund(db, input) {
  const outTradeNo = assertNonEmptyString(input?.outTradeNo, 'outTradeNo')
  const operator = assertNonEmptyString(input?.operator, 'operator')
  const reason = normalizeRefundReason(input?.reason)
  const now = Number.isFinite(input?.now) ? input.now : Date.now()
  const outRefundNo = buildOutRefundNo(outTradeNo)

  return db.runTransaction(async (transaction) => {
    const order = await findOrderByOutTradeNo(transaction, outTradeNo)
    if (order?.refund) {
      if (order.refund.outRefundNo !== outRefundNo)
        throw new Error('订单已存在不一致的退款单号，需人工复核')
      return {
        order,
        refund: order.refund,
        deduped: true,
        result: refundResult(order, { deduped: true }),
      }
    }

    assertRefundEligibility(order, now)

    const refund = {
      outRefundNo,
      status: 'REQUESTED',
      entitlementStatus: 'pending',
      amount: order.amount,
      currency: 'CNY',
      reason,
      requestedBy: operator,
      requestedAt: now,
      attempts: 0,
      updatedAt: now,
      audit: [{
        action: 'refund.requested',
        actor: operator,
        at: now,
      }],
    }
    const updatedOrder = await writeRefundState(transaction, order, refund, {
      refundRequestedAt: now,
      refundRequestedBy: operator,
    })
    return {
      order: updatedOrder,
      refund,
      deduped: false,
      result: refundResult(updatedOrder, { deduped: false }),
    }
  })
}

async function markRefundRequestAttempt(db, outTradeNo, now = Date.now()) {
  return db.runTransaction(async (transaction) => {
    const order = await findOrderByOutTradeNo(transaction, outTradeNo)
    if (!order?.refund)
      throw new Error('退款意图不存在')
    if (!['REQUESTED', 'REQUEST_FAILED'].includes(order.refund.status))
      return order
    const refund = {
      ...order.refund,
      attempts: (Number(order.refund.attempts) || 0) + 1,
      lastAttemptAt: now,
      lastError: '',
      updatedAt: now,
      audit: appendAuditEvent(order.refund, {
        action: 'refund.request-attempted',
        actor: order.refund.requestedBy || '',
        at: now,
      }),
    }
    return writeRefundState(transaction, order, refund)
  })
}

async function markRefundRequestFailed(db, input) {
  const now = Number.isFinite(input?.now) ? input.now : Date.now()
  const message = typeof input?.error === 'string' && input.error.trim()
    ? input.error.trim().slice(0, 500)
    : '微信退款申请失败'
  return db.runTransaction(async (transaction) => {
    const order = await findOrderByOutTradeNo(transaction, input?.outTradeNo)
    if (!order?.refund)
      throw new Error('退款意图不存在')
    if (!['REQUESTED', 'REQUEST_FAILED'].includes(order.refund.status))
      return refundResult(order, { deduped: true })
    const refund = {
      ...order.refund,
      status: 'REQUEST_FAILED',
      lastError: message,
      updatedAt: now,
      audit: appendAuditEvent(order.refund, {
        action: 'refund.request-failed',
        actor: order.refund.requestedBy || '',
        at: now,
        message,
      }),
    }
    const updatedOrder = await writeRefundState(transaction, order, refund)
    return refundResult(updatedOrder)
  })
}

async function markManualReview(db, order, refund, now, reason) {
  const nextRefund = {
    ...refund,
    entitlementStatus: 'manual_review_required',
    manualReviewReason: reason,
    updatedAt: now,
    audit: appendAuditEvent(refund, {
      action: 'refund.entitlement-manual-review',
      actor: 'system',
      at: now,
      message: reason,
    }),
  }
  return writeRefundState(db, order, nextRefund, {
    refundEntitlementStatus: 'manual_review_required',
  })
}

async function rollbackMembershipEntitlement(db, order, now) {
  return db.runTransaction(async (transaction) => {
    // 回调与主动查询可能并发，事务内重新读取，确保会员回滚和订单标记原子提交。
    const currentOrder = await findOrderByOutTradeNo(transaction, order.outTradeNo)
    if (!currentOrder?.refund)
      throw new Error('退款意图不存在')
    const currentRefund = currentOrder.refund

    if (
      currentRefund.entitlementStatus === 'reverted'
      || currentOrder.refundEntitlementStatus === 'reverted'
    ) {
      return refundResult(currentOrder, { entitlementStatus: 'reverted', deduped: true })
    }
    if (
      currentRefund.entitlementStatus === 'manual_review_required'
      || currentOrder.refundEntitlementStatus === 'manual_review_required'
    ) {
      return refundResult(currentOrder, {
        entitlementStatus: 'manual_review_required',
        manualReviewRequired: true,
        deduped: true,
      })
    }

    const membership = await readMembership(transaction, currentOrder.userId)
    const grant = currentOrder.membershipGrant
    if (
      !membership
      || !grant
      || membership.lastOrderId !== currentOrder.outTradeNo
      || membership.expireAt !== grant.expireAfter
    ) {
      const updatedOrder = await markManualReview(
        transaction,
        currentOrder,
        currentRefund,
        now,
        '当前会员状态与该订单发放快照不一致',
      )
      return refundResult(updatedOrder, {
        entitlementStatus: 'manual_review_required',
        manualReviewRequired: true,
      })
    }

    const expireAt = Number.isFinite(grant.expireBefore) ? grant.expireBefore : now
    const fallbackAnchor = resolveBillingAnchor({ base: expireAt })
    const rollback = {
      expireAt,
      billingAnchorDay: Number.isInteger(grant.billingAnchorDayBefore)
        ? grant.billingAnchorDayBefore
        : fallbackAnchor.billingAnchorDay,
      billingAnchorIsMonthEnd: typeof grant.billingAnchorIsMonthEndBefore === 'boolean'
        ? grant.billingAnchorIsMonthEndBefore
        : fallbackAnchor.billingAnchorIsMonthEnd,
      activeCycle: grant.activeCycleBefore || 'refunded',
      lastOrderId: grant.lastOrderIdBefore || null,
      updatedAt: now,
    }
    if (grant.planIdBefore)
      rollback.planId = grant.planIdBefore
    if (grant.levelBefore)
      rollback.level = grant.levelBefore

    const rollbackResult = await transaction
      .collection(MEMBERSHIPS_COLLECTION)
      .where({
        _id: membership._id,
        lastOrderId: currentOrder.outTradeNo,
        expireAt: grant.expireAfter,
      })
      .update(rollback)
    if (affectedCount(rollbackResult) === 0) {
      const updatedOrder = await markManualReview(
        transaction,
        currentOrder,
        currentRefund,
        now,
        '会员权益在回滚时发生并发变化',
      )
      return refundResult(updatedOrder, {
        entitlementStatus: 'manual_review_required',
        manualReviewRequired: true,
      })
    }

    const nextRefund = {
      ...currentRefund,
      entitlementStatus: 'reverted',
      entitlementRevertedAt: now,
      updatedAt: now,
      audit: appendAuditEvent(currentRefund, {
        action: 'refund.entitlement-reverted',
        actor: 'system',
        at: now,
      }),
    }
    const updatedOrder = await writeRefundState(transaction, currentOrder, nextRefund, {
      refundEntitlementStatus: 'reverted',
    })
    return refundResult(updatedOrder, {
      entitlementStatus: 'reverted',
      entitlementReverted: true,
    })
  })
}

/**
 * 应用微信退款结果。可由退款申请响应、主动查单或签名回调重复调用。
 */
async function applyWechatRefundResult(db, input) {
  const outTradeNo = assertNonEmptyString(input?.outTradeNo, 'outTradeNo')
  const outRefundNo = assertNonEmptyString(input?.outRefundNo, 'outRefundNo')
  const status = assertNonEmptyString(input?.status, '退款状态').toUpperCase()
  if (!WECHAT_REFUND_STATUSES.has(status))
    throw new Error(`未知微信退款状态: ${status}`)
  if (input?.expectedMchid && input.expectedMchid !== input?.resourceMchid)
    throw new Error('退款回调商户号不匹配')

  const now = Number.isFinite(input?.now) ? input.now : Date.now()
  const transition = await db.runTransaction(async (transaction) => {
    const order = await findOrderByOutTradeNo(transaction, outTradeNo)
    if (!order?.refund) {
      return {
        handled: false,
        result: { handled: false, reason: 'refund_not_managed', outTradeNo, outRefundNo },
      }
    }
    if (order.refund.outRefundNo !== outRefundNo)
      throw new Error('退款单号与本地退款意图不匹配')
    if (!['paid', 'refunded'].includes(order.status))
      throw new Error(`订单状态不可接收退款结果: ${order.status}`)
    if (
      Number.isInteger(input?.refundAmount)
      && input.refundAmount !== order.refund.amount
    ) {
      throw new Error('退款金额与本地退款意图不匹配')
    }
    if (
      Number.isInteger(input?.totalAmount)
      && input.totalAmount !== order.amount
    ) {
      throw new Error('退款原订单金额与本地订单不匹配')
    }
    if (order.refund.status === 'SUCCESS' && status !== 'SUCCESS') {
      return {
        handled: true,
        order,
        result: { handled: true, ...refundResult(order, { deduped: true }) },
      }
    }

    const refund = {
      ...order.refund,
      status,
      refundId: typeof input?.refundId === 'string' ? input.refundId : order.refund.refundId || '',
      successTime: typeof input?.successTime === 'string' ? input.successTime : order.refund.successTime || '',
      lastError: '',
      source: typeof input?.source === 'string' ? input.source : 'wechat',
      updatedAt: now,
      audit: order.refund.status === status
        ? order.refund.audit
        : appendAuditEvent(order.refund, {
            action: `refund.status.${status.toLowerCase()}`,
            actor: typeof input?.source === 'string' ? input.source : 'wechat',
            at: now,
          }),
    }
    const orderUpdates = status === 'SUCCESS'
      ? {
          status: 'refunded',
          refundedAt: order.refundedAt || now,
        }
      : {}
    const updatedOrder = await writeRefundState(transaction, order, refund, orderUpdates)
    return {
      handled: true,
      order: updatedOrder,
      result: { handled: true, ...refundResult(updatedOrder) },
    }
  })

  if (!transition.handled || transition.order?.refund?.status !== 'SUCCESS')
    return transition.result

  const entitlement = await rollbackMembershipEntitlement(db, transition.order, now)
  return { handled: true, ...entitlement }
}

async function getMembershipRefund(db, outTradeNo) {
  const order = await findOrderByOutTradeNo(db, assertNonEmptyString(outTradeNo, 'outTradeNo'))
  if (!order)
    throw new Error('订单不存在')
  if (!order.refund)
    return refundResult(order)
  return refundResult(order)
}

module.exports = {
  MEMBERSHIP_REFUND_WINDOW_MS,
  REFUND_REASON_MAX_LENGTH,
  WECHAT_REFUND_STATUSES,
  applyWechatRefundResult,
  buildOutRefundNo,
  getMembershipRefund,
  markRefundRequestAttempt,
  markRefundRequestFailed,
  prepareMembershipRefund,
}
