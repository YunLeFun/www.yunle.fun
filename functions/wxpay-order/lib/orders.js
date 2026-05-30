/**
 * 订单与会员开通的原子操作（依赖注入式，便于单元测试）。
 *
 * 通过把 db 作为参数传入而不是模块级单例，使本文件可被 vitest 用 mock db 直接测试，
 * 同时也允许 wxpay-order 与 wxpay-notify 复用同一份逻辑。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { computeNewExpireAt } = require('./membership')

const ORDERS_COLLECTION = 'orders'
const MEMBERSHIPS_COLLECTION = 'user_memberships'

/** activateMembership 在并发冲突时的最大重试次数 */
const MEMBERSHIP_MAX_RETRY = 5

/**
 * 用 outTradeNo 查找订单
 *
 * @param {object} db CloudBase database 实例
 * @param {string} outTradeNo
 * @returns {Promise<object|null>}
 */
async function findOrderByOutTradeNo(db, outTradeNo) {
  const { data } = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 原子地将订单从 pending 标记为 paid。
 *
 * 使用 conditional update（where status: pending）保证并发安全：
 * - 第一条回调：updated = 1，调用方负责后续开通会员
 * - 重放/竞态：updated = 0，调用方应视为幂等成功，跳过开通
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.outTradeNo
 * @param {string} input.transactionId
 * @param {number} input.now
 * @returns {Promise<{ updated: number }>} updated=1 表示首次成功
 */
async function markOrderPaid(db, { outTradeNo, transactionId, now }) {
  const result = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo, status: 'pending' })
    .update({
      status: 'paid',
      transactionId,
      paidAt: now,
      updatedAt: now,
    })
  // CloudBase NoSQL 返回结构兼容：result.updated / result.matched
  const updated = result?.updated ?? result?.modifiedCount ?? 0
  return { updated }
}

/**
 * 为用户开通/续费会员。
 *
 * 流程：
 *   1. 读现有 user_memberships
 *   2. 计算新到期日
 *   3. upsert
 *
 * 注意：CloudBase NoSQL 没有跨 collection 事务，会员开通在订单标 paid 之后调用，
 * 通过 markOrderPaid 的 conditional update 保证只有一条回调进入本函数，
 * 因此 read-modify-write 不会被重复触发。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId CloudBase uid
 * @param {string} input.planId
 * @param {string} input.cycle 'month' | 'year'
 * @param {number} input.now
 * @param {string} input.outTradeNo 用于日志
 * @returns {Promise<{ planId: string, cycle: string, expireAt: number }>}
 */
async function activateMembership(db, { userId, planId, cycle, now, outTradeNo }) {
  if (!userId)
    throw new Error(`activateMembership: 订单 ${outTradeNo} 缺少 userId，无法开通会员`)

  // 并发安全：read-modify-write 在跨订单同用户并发下会丢更新（老用户）或撞唯一索引（新用户）。
  // 用 compare-and-set 重试解决：
  //   - 已存在：以读到的 expireAt 作为乐观锁条件更新，被人抢先改了就重读重试
  //   - 不存在：尝试 add；若被并发 insert 撞唯一索引（userId unique），回到循环走 update 分支
  let lastError = null
  for (let attempt = 0; attempt < MEMBERSHIP_MAX_RETRY; attempt++) {
    const { data } = await db
      .collection(MEMBERSHIPS_COLLECTION)
      .where({ userId })
      .limit(1)
      .get()
    const existing = Array.isArray(data) && data.length > 0 ? data[0] : null
    const newExpireAt = computeNewExpireAt({
      current: existing?.expireAt,
      cycle,
      now,
    })
    const payload = {
      userId,
      planId,
      activeCycle: cycle,
      expireAt: newExpireAt,
      lastOrderId: outTradeNo,
      updatedAt: now,
    }

    if (existing) {
      // 乐观锁：仅当 expireAt 仍是刚读到的值时才更新，防止并发覆盖
      const result = await db
        .collection(MEMBERSHIPS_COLLECTION)
        .where({ userId, expireAt: existing.expireAt })
        .update(payload)
      const updated = result?.updated ?? result?.modifiedCount ?? 0
      if (updated > 0)
        return { planId, cycle, expireAt: newExpireAt }
      // 被并发改写，重读重试
      continue
    }

    try {
      await db
        .collection(MEMBERSHIPS_COLLECTION)
        .add({ ...payload, createdAt: now })
      return { planId, cycle, expireAt: newExpireAt }
    }
    catch (err) {
      // 并发 insert 撞唯一索引：重读后走 update 分支
      lastError = err
    }
  }

  throw lastError || new Error(`activateMembership: 订单 ${outTradeNo} 并发重试 ${MEMBERSHIP_MAX_RETRY} 次仍未成功`)
}

module.exports = {
  ORDERS_COLLECTION,
  MEMBERSHIPS_COLLECTION,
  findOrderByOutTradeNo,
  markOrderPaid,
  activateMembership,
}
