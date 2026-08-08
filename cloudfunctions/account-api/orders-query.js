/**
 * 订单只读查询（account-api 本地模块，非同步 lib）。
 *
 * 供「我的钱包 → 订单历史」展示：按当前登录 userId 倒序分页列出订单，
 * 投影为脱敏摘要（不含微信交易号等内部字段）。订单写入 / 状态机仍在 wxpay-order/lib。
 */

'use strict'

/** 与 wxpay-order/lib/orders.js 的 ORDERS_COLLECTION 一致 */
const ORDERS_COLLECTION = 'orders'

/** 合法订单状态（其余一律归为 pending 以免泄漏未知态） */
const KNOWN_STATUS = new Set(['pending', 'paid', 'failed', 'refunded', 'closed', 'synthetic'])

/**
 * 订单对外投影：仅暴露展示所需字段，兼容 membership / recharge_coin / 历史 test 单。
 * @param {object} doc 订单文档
 * @returns {object} 脱敏订单摘要
 */
function toOrderSummary(doc) {
  const orderType = doc.orderType || 'membership'
  return {
    id: doc.outTradeNo || doc._id || '',
    orderType,
    appId: doc.appId || '',
    amount: typeof doc.amount === 'number' ? doc.amount : 0,
    status: KNOWN_STATUS.has(doc.status) ? doc.status : 'pending',
    payType: doc.payType || '',
    synthetic: doc.synthetic === true,
    // 会员单
    level: doc.level || doc.planId || null,
    billingCycle: doc.billingCycle || null,
    // 云币充值单
    coinAmount: typeof doc.coinAmount === 'number' ? doc.coinAmount : null,
    packId: doc.packId || null,
    createdAt: doc.createdAt || 0,
    // 已支付订单回写在 updatedAt（无独立 paidAt 字段）
    paidAt: doc.status === 'paid' ? (doc.updatedAt || null) : null,
  }
}

/**
 * 列出某用户订单（按创建时间倒序分页）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId 当前登录用户
 * @param {number} [input.skip]
 * @param {number} [input.limit]
 * @returns {Promise<{ items: object[], nextSkip: number|null }>} 订单摘要列表与下一页游标（满页才有，否则 null）
 */
async function listUserOrders(db, { userId, skip = 0, limit = 20 } = {}) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('userId 必须为非空字符串')
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const sk = Math.max(Number(skip) || 0, 0)
  const { data } = await db
    .collection(ORDERS_COLLECTION)
    .where({ userId: userId.trim() })
    .orderBy('createdAt', 'desc')
    .skip(sk)
    .limit(lim)
    .get()
  const arr = Array.isArray(data) ? data : []
  return {
    items: arr.map(toOrderSummary),
    nextSkip: arr.length === lim ? sk + lim : null,
  }
}

module.exports = {
  ORDERS_COLLECTION,
  toOrderSummary,
  listUserOrders,
}
