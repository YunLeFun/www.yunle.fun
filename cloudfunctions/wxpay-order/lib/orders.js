/**
 * 订单与会员开通的原子操作（依赖注入式，便于单元测试）。
 *
 * 通过把 db 作为参数传入而不是模块级单例，使本文件可被 vitest 用 mock db 直接测试，
 * 同时也允许 wxpay-order 与 wxpay-notify 复用同一份逻辑。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { computeNewMembershipPeriod, resolveBillingAnchor } = require('./membership')
const { creditCoin } = require('./wallet')

const ORDERS_COLLECTION = 'orders'
const MEMBERSHIPS_COLLECTION = 'user_memberships'

/** activateMembership 在并发冲突时的最大重试次数 */
const MEMBERSHIP_MAX_RETRY = 5

function firstDoc(data) {
  if (Array.isArray(data))
    return data[0] || null
  return data || null
}

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
 * 读取用户会员记录（优先读 `_id == uid` 的规范文档，兼容历史 `add({ userId })` 文档）。
 *
 * @param {object} db
 * @param {string} userId CloudBase uid
 * @returns {Promise<object|null>}
 */
async function readMembership(db, userId) {
  if (!userId)
    return null

  const collection = db.collection(MEMBERSHIPS_COLLECTION)
  if (typeof collection.doc === 'function') {
    const byId = await collection.doc(userId).get()
    const doc = firstDoc(byId?.data)
    if (doc && typeof doc === 'object' && (!doc.userId || doc.userId === userId))
      return { ...doc, _id: userId, userId: doc.userId || userId }
  }

  const { data } = await collection
    .where({ userId })
    .limit(10)
    .get()
  if (!Array.isArray(data) || data.length === 0)
    return null

  return data.find(item => item?._id === userId) || data[0]
}

async function createCanonicalMembership(db, userId, payload, existing, now) {
  const canonical = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...payload,
    _id: userId,
    userId,
    createdAt: existing?.createdAt || now,
  }
  await db.collection(MEMBERSHIPS_COLLECTION).add(canonical)
  return canonical
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
 * 标记订单权益已发放（写入 grantedAt）。
 *
 * 供「已 paid 但未发放」自愈对账识别：status=paid 且无 grantedAt 的订单会被重新发放
 * （见 wxpay-order/index.js 的 reconcileOrders）。
 *
 * 回写失败不应阻断主流程——底层发放（会员 lastOrderId / 云币 refId）本身幂等，
 * 下次对账重入不会重复发放，因此调用方对本函数的失败只记日志即可。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.outTradeNo
 * @param {number} input.now
 * @param {object|null} [input.membershipGrant]
 * @returns {Promise<{ updated: number }>} updated=1 表示已写入 grantedAt
 */
async function markOrderGranted(db, { outTradeNo, now, membershipGrant }) {
  const updates = { grantedAt: now, updatedAt: now }
  if (membershipGrant)
    updates.membershipGrant = membershipGrant
  const result = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .update(updates)
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
 * @returns {Promise<{ planId: string, cycle: string, expireAt: number, billingAnchorDay: number, billingAnchorIsMonthEnd: boolean }>}
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
    const existing = await readMembership(db, userId)

    // 幂等：本订单已开通过（lastOrderId 命中）→ 直接返回，避免补偿/重试重复续期。
    // 与云币发放的 refId 幂等对齐，使「paid 但未发放」的补发、回调重放都能安全重入。
    if (existing && outTradeNo && existing.lastOrderId === outTradeNo) {
      const anchor = Number.isFinite(existing.expireAt)
        ? resolveBillingAnchor({
            billingAnchorDay: existing.billingAnchorDay,
            billingAnchorIsMonthEnd: existing.billingAnchorIsMonthEnd,
            base: existing.expireAt,
          })
        : {}
      if (existing._id !== userId) {
        try {
          await createCanonicalMembership(db, userId, {
            userId,
            planId: existing.planId || planId,
            activeCycle: existing.activeCycle || cycle,
            expireAt: existing.expireAt,
            ...anchor,
            lastOrderId: outTradeNo,
            updatedAt: existing.updatedAt || now,
          }, existing, now)
        }
        catch (err) {
          lastError = err
          continue
        }
      }
      return {
        planId: existing.planId || planId,
        cycle: existing.activeCycle || cycle,
        expireAt: existing.expireAt,
        ...anchor,
      }
    }

    const period = computeNewMembershipPeriod({
      current: existing?.expireAt,
      cycle,
      now,
      billingAnchorDay: existing?.billingAnchorDay,
      billingAnchorIsMonthEnd: existing?.billingAnchorIsMonthEnd,
    })
    const { expireAt: newExpireAt, billingAnchorDay, billingAnchorIsMonthEnd } = period
    const membershipBefore = existing
      ? {
          expireAt: Number.isFinite(existing.expireAt) ? existing.expireAt : null,
          billingAnchorDay: Number.isInteger(existing.billingAnchorDay) ? existing.billingAnchorDay : null,
          billingAnchorIsMonthEnd: typeof existing.billingAnchorIsMonthEnd === 'boolean'
            ? existing.billingAnchorIsMonthEnd
            : null,
          activeCycle: existing.activeCycle || null,
          planId: existing.planId || null,
          level: existing.level || null,
          lastOrderId: existing.lastOrderId || null,
        }
      : null
    const payload = {
      userId,
      planId,
      activeCycle: cycle,
      expireAt: newExpireAt,
      billingAnchorDay,
      billingAnchorIsMonthEnd,
      lastOrderId: outTradeNo,
      updatedAt: now,
    }

    if (existing) {
      if (existing._id !== userId) {
        try {
          await createCanonicalMembership(db, userId, payload, existing, now)
          return {
            planId,
            cycle,
            expireAt: newExpireAt,
            billingAnchorDay,
            billingAnchorIsMonthEnd,
            membershipBefore,
          }
        }
        catch (err) {
          // 规范文档可能刚被并发请求创建，重读后走规范 update 分支
          lastError = err
          continue
        }
      }

      // 乐观锁：仅当 expireAt 仍是刚读到的值时才更新，防止并发覆盖
      const result = await db
        .collection(MEMBERSHIPS_COLLECTION)
        .where({ _id: userId, expireAt: existing.expireAt })
        .update(payload)
      const updated = result?.updated ?? result?.modifiedCount ?? 0
      if (updated > 0) {
        return {
          planId,
          cycle,
          expireAt: newExpireAt,
          billingAnchorDay,
          billingAnchorIsMonthEnd,
          membershipBefore,
        }
      }
      // 被并发改写，重读重试
      continue
    }

    try {
      await db
        .collection(MEMBERSHIPS_COLLECTION)
        .add({ _id: userId, ...payload, createdAt: now })
      return {
        planId,
        cycle,
        expireAt: newExpireAt,
        billingAnchorDay,
        billingAnchorIsMonthEnd,
        membershipBefore,
      }
    }
    catch (err) {
      // 并发 insert 撞唯一索引：重读后走 update 分支
      lastError = err
    }
  }

  throw lastError || new Error(`activateMembership: 订单 ${outTradeNo} 并发重试 ${MEMBERSHIP_MAX_RETRY} 次仍未成功`)
}

/**
 * 支付成功后按订单类型发放权益（会员开通 / 云币入账）的唯一分支点。
 *
 * 被 wxpay-notify 回调与 wxpay-order 的 queryOrder 兜底共用，保证发放逻辑只有一处。
 * 调用前提：markOrderPaid 已返回 updated>0（即本次是首次确认），因此本函数内部不再处理订单状态。
 *
 * @param {object} db
 * @param {object} input
 * @param {object} input.order 已 paid 的订单文档
 * @param {number} input.now
 * @param {number} [input.entitlementAt] 权益周期起算依据；IAP 会员缺省为渠道购买时间，其他为 now
 * @returns {Promise<object>} 发放结果（会员到期信息或云币余额）
 * @throws orderType 未知或发放失败
 */
async function grantOrderEntitlement(db, { order, now, entitlementAt }) {
  // 幂等：订单已发放过（grantedAt 命中）→ 跳过。与底层发放幂等（会员 lastOrderId /
  // 云币 refId）构成双保险，让回调重放、对账补发都能安全重入。
  if (order.grantedAt)
    return { alreadyGranted: true }

  // 兼容历史订单：无 orderType 视为会员订单
  const orderType = order.orderType || 'membership'
  const resolvedEntitlementAt = Number.isFinite(entitlementAt)
    ? entitlementAt
    : orderType === 'membership' && order.payType === 'iap' && Number.isFinite(order.providerPurchasedAt)
      ? order.providerPurchasedAt
      : now

  let result
  let membershipGrant = null
  if (orderType === 'membership') {
    const activation = await activateMembership(db, {
      userId: order.userId,
      // 兼容 level（新）与 planId（旧）
      planId: order.level || order.planId,
      cycle: order.billingCycle,
      now: resolvedEntitlementAt,
      outTradeNo: order.outTradeNo,
    })
    const { membershipBefore, ...publicResult } = activation
    result = publicResult
    // lastOrderId 幂等命中代表权益已在更早的调用中发放，此时无法可靠重建购买前状态。
    // 不伪造退款快照；若后续退款，安全策略会保留当前会员并转人工复核。
    if (membershipBefore !== undefined) {
      membershipGrant = {
        expireBefore: membershipBefore?.expireAt ?? null,
        expireAfter: activation.expireAt,
        billingAnchorDayBefore: membershipBefore?.billingAnchorDay ?? null,
        billingAnchorIsMonthEndBefore: membershipBefore?.billingAnchorIsMonthEnd ?? null,
        activeCycleBefore: membershipBefore?.activeCycle ?? null,
        planIdBefore: membershipBefore?.planId ?? null,
        levelBefore: membershipBefore?.level ?? null,
        lastOrderIdBefore: membershipBefore?.lastOrderId ?? null,
      }
    }
  }
  else if (orderType === 'recharge_coin') {
    if (!Number.isInteger(order.coinAmount) || order.coinAmount <= 0)
      throw new Error(`grantOrderEntitlement: 订单 ${order.outTradeNo} coinAmount 非法: ${order.coinAmount}`)
    result = await creditCoin(db, {
      userId: order.userId,
      appId: order.appId,
      amount: order.coinAmount,
      type: 'recharge',
      refId: order.outTradeNo, // 幂等键
      meta: { packId: order.packId || '' },
      now,
    })
  }
  else {
    throw new Error(`grantOrderEntitlement: 未知 orderType: ${orderType}`)
  }

  // 发放成功 → 回写 grantedAt，供自愈对账跳过已发放订单。
  // 回写失败不抛错：底层发放幂等，下次重入不会重复发放。
  try {
    await markOrderGranted(db, { outTradeNo: order.outTradeNo, now, membershipGrant })
  }
  catch (err) {
    console.error('[orders] grantedAt 回写失败（权益已发放，不影响）:', order.outTradeNo, err.message)
  }

  return result
}

module.exports = {
  ORDERS_COLLECTION,
  MEMBERSHIPS_COLLECTION,
  findOrderByOutTradeNo,
  readMembership,
  markOrderPaid,
  markOrderGranted,
  activateMembership,
  grantOrderEntitlement,
}
