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
const { clawbackCoin } = require('./wallet')

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
 *   - 订单标记 refunded（conditional update，幂等）
 *   - 会员订单：首次转移时立即失效（expireAt = now）
 *   - 云币订单：自动追回未消费余额，扣到零封顶（clawbackCoin 按 refId 幂等），
 *     余额不足的差额即平台资损，记日志供人工对账。
 *     订单已是 refunded 时仍重放追回（幂等），补偿「标记成功但追回中断」的窗口。
 *
 * @param {object} db
 * @param {object} input
 * @param {object} input.payload Apple 交易 payload（须已通过 Server API 回查确认）
 * @param {number} input.now
 * @returns {Promise<{ handled: boolean, orderType?: string, outTradeNo: string, clawed?: number }>}
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
  // 既非首次 paid -> refunded 转移，也不是已退款订单的重试补偿（如 pending）：不处理
  if (updated === 0 && order.status !== 'refunded')
    return { handled: false, orderType: order.orderType, outTradeNo }

  if (order.orderType === 'membership') {
    if (updated > 0) {
      // 会员立即失效（仅首次转移时执行，避免重复通知误伤其后新购的会员）
      await db
        .collection(MEMBERSHIPS_COLLECTION)
        .where({ userId: order.userId })
        .update({ expireAt: now, updatedAt: now })
    }
    return { handled: updated > 0, orderType: order.orderType, outTradeNo }
  }

  if (!Number.isInteger(order.coinAmount) || order.coinAmount <= 0) {
    console.warn(`[iap] 云币退款订单 coinAmount 非法，跳过追回: ${outTradeNo}`)
    return { handled: updated > 0, orderType: order.orderType, outTradeNo }
  }

  const { clawed, balance } = await clawbackCoin(db, {
    userId: order.userId,
    appId: order.appId || IAP_APP_ID,
    amount: order.coinAmount,
    refId: outTradeNo,
    meta: { source: 'appstore-refund', transactionId },
    now,
  })
  if (clawed < order.coinAmount) {
    console.warn(
      `[iap] 云币退款追回不足（差额计损）: outTradeNo=${outTradeNo} userId=${order.userId} 应追回=${order.coinAmount} 实际=${clawed} 余额=${balance}`,
    )
  }

  return { handled: updated > 0, orderType: order.orderType, outTradeNo, clawed }
}

module.exports = {
  IAP_APP_ID,
  IAP_OUT_TRADE_NO_PREFIX,
  priceToFen,
  grantIapTransaction,
  handleIapRefund,
}
