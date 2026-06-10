/**
 * iOS IAP 入账 / 退款的原子操作（依赖注入式，便于单元测试）。
 *
 * 复用微信支付的订单状态机与钱包账本：
 *   - 每笔 IAP 交易写一条 orders 记录（payType: 'iap'，outTradeNo: `iap_<transactionId>`）
 *   - markOrderPaid 的 conditional update 保证单交易只发放一次
 *   - creditCoin 的 refId 去重是二次保险
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const {
  findOrderByOutTradeNo,
  grantOrderEntitlement,
  markOrderPaid,
  MEMBERSHIPS_COLLECTION,
  ORDERS_COLLECTION,
} = require('./orders')
const { COIN_PACKS, getIapProduct } = require('./plans')

/** IAP 订单归属的应用标识（apps.yunle.fun 的 appId） */
const IAP_APP_ID = 'apps'

/** outTradeNo 前缀，与微信订单区分 */
const IAP_OUT_TRADE_NO_PREFIX = 'iap_'

/**
 * 将 Apple 交易 payload 的标价换算为分（仅 CNY；其他币种返回 0，原始值入 meta）。
 * Apple 的 price 字段单位是货币毫单位（milliunits），如 ¥12.00 = 12000。
 *
 * @param {object} payload
 * @returns {number}
 */
function priceToFen(payload) {
  if (payload.currency === 'CNY' && Number.isFinite(payload.price))
    return Math.round(payload.price / 10)
  return 0
}

/**
 * 为已通过 Server API 确认的 IAP 交易发放权益（幂等）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId CloudBase uid
 * @param {object} input.payload Apple 交易 payload（须已通过 assertGrantablePayload）
 * @param {string} input.environment 'Production' | 'Sandbox'
 * @param {number} input.now
 * @returns {Promise<{ granted: boolean, alreadyProcessed?: boolean, grant?: object, outTradeNo: string }>}
 * @throws 商品未知 / 交易归属其他账号
 */
async function grantIapTransaction(db, { userId, payload, environment, now }) {
  if (!userId)
    throw new Error('grantIapTransaction: 缺少 userId')
  const transactionId = String(payload.transactionId)
  const outTradeNo = `${IAP_OUT_TRADE_NO_PREFIX}${transactionId}`
  const product = getIapProduct(payload.productId)

  let order = await findOrderByOutTradeNo(db, outTradeNo)
  // 防串号：同一笔 Apple 交易只能由首个绑定的账号领取
  if (order && order.userId !== userId)
    throw new Error('该交易已绑定其他账号')

  if (!order) {
    const base = {
      userId,
      appId: IAP_APP_ID,
      orderType: product.orderType,
      amount: priceToFen(payload),
      payType: 'iap',
      status: 'pending',
      outTradeNo,
      transactionId,
      meta: {
        productId: payload.productId,
        environment,
        price: payload.price ?? null,
        currency: payload.currency || '',
        originalTransactionId: String(payload.originalTransactionId || transactionId),
      },
      createdAt: now,
      updatedAt: now,
    }
    if (product.orderType === 'membership') {
      base.level = product.level
      base.planId = product.level
      base.billingCycle = product.billingCycle
    }
    else {
      base.packId = product.packId
      base.coinAmount = COIN_PACKS[product.packId].coin
    }
    // 并发双写风险：同一交易并发两次首调可能 add 两条 pending 订单。
    // markOrderPaid 的 conditional update 会一次置 paid，grantOrderEntitlement
    // 只执行一次；creditCoin 的 refId 去重兜底，权益不会重复发放。
    await db.collection(ORDERS_COLLECTION).add(base)
    order = await findOrderByOutTradeNo(db, outTradeNo)
  }

  if (order.status === 'paid' || order.status === 'refunded')
    return { granted: false, alreadyProcessed: true, outTradeNo }

  const { updated } = await markOrderPaid(db, { outTradeNo, transactionId, now })
  if (updated === 0)
    return { granted: false, alreadyProcessed: true, outTradeNo }

  const grant = await grantOrderEntitlement(db, { order: { ...order, status: 'paid' }, now })
  return { granted: true, grant, outTradeNo }
}

/**
 * 处理 Apple 退款 / 撤销通知（REFUND / REVOKE）。
 *
 * 保守策略（资损边界为产品决策，先不自动追回云币）：
 *   - 订单标记 refunded（conditional update，幂等）
 *   - 会员订单：若会员仍有效则立即失效（expireAt = now）
 *   - 云币订单：仅记录日志，由人工经 adminAdjustCoin 决定是否追回
 *     （余额可能已消费，自动扣成负数需产品拍板）
 *
 * @param {object} db
 * @param {object} input
 * @param {object} input.payload Apple 交易 payload（须已通过 Server API 回查确认）
 * @param {number} input.now
 * @returns {Promise<{ handled: boolean, orderType?: string, outTradeNo: string }>}
 */
async function handleIapRefund(db, { payload, now }) {
  const transactionId = String(payload.transactionId)
  const outTradeNo = `${IAP_OUT_TRADE_NO_PREFIX}${transactionId}`

  const order = await findOrderByOutTradeNo(db, outTradeNo)
  if (!order) {
    console.warn(`[iap] 退款通知对应订单不存在: ${outTradeNo}`)
    return { handled: false, outTradeNo }
  }

  const result = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo, status: 'paid' })
    .update({ status: 'refunded', updatedAt: now })
  const updated = result?.updated ?? result?.modifiedCount ?? 0
  if (updated === 0)
    return { handled: false, orderType: order.orderType, outTradeNo }

  if (order.orderType === 'membership') {
    // 会员立即失效（仅当仍有效；已过期无需处理）
    await db
      .collection(MEMBERSHIPS_COLLECTION)
      .where({ userId: order.userId })
      .update({ expireAt: now, updatedAt: now })
  }
  else {
    console.warn(
      `[iap] 云币订单退款，待人工处理追回: outTradeNo=${outTradeNo} userId=${order.userId} coin=${order.coinAmount}`,
    )
  }

  return { handled: true, orderType: order.orderType, outTradeNo }
}

module.exports = {
  IAP_APP_ID,
  IAP_OUT_TRADE_NO_PREFIX,
  priceToFen,
  grantIapTransaction,
  handleIapRefund,
}
