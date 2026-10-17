/** IAP 归属与权益凭据同事务提交。权威源；运行 pnpm sync:wxpay-lib 同步。 */
'use strict'

const crypto = require('node:crypto')
const { computeNewMembershipPeriod } = require('./membership')
const { MEMBERSHIPS_COLLECTION, ORDERS_COLLECTION } = require('./orders')
const { creditCoinInTransaction, prepareCoinCredit } = require('./wallet')

/** 与原生 PurchaseAccountToken.forUser 的 UTF-8 / SHA-256 / UUID v8 格式一致。 */
function purchaseAccountToken(userId) {
  const bytes = crypto.createHash('sha256').update(`fun.yunle.apps.iap-owner.v1\0${userId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0F) | 0x80
  bytes[8] = (bytes[8] & 0x3F) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function assertPurchaseOwner(userId, payload) {
  if (!Object.hasOwn(payload, 'appAccountToken'))
    return null // 旧客户端没有该标记；仍仅允许首次绑定的账号领取。
  const token = payload.appAccountToken
  if (typeof token !== 'string' || token.toLowerCase() !== purchaseAccountToken(userId))
    throw new Error('Apple 交易账号标记与当前账号不匹配')
  return token.toLowerCase()
}

function assertResult(result) {
  if (result?.code) {
    const error = new Error('IAP 数据库操作失败')
    error.code = result.code
    throw error
  }
}

async function readDoc(ref) {
  const result = await ref.get()
  assertResult(result)
  return Array.isArray(result?.data) ? result.data[0] || null : result?.data || null
}

async function setDoc(ref, data) {
  const { _id: _documentId, ...writable } = data
  assertResult(await ref.set(writable))
}

function assertOrderMatch(order, base) {
  if (!order)
    return
  if (order.userId !== base.userId)
    throw new Error('该交易已绑定其他账号')
  if (
    order.payType !== 'iap' || order.outTradeNo !== base.outTradeNo
    || order.transactionId !== base.transactionId || order.appId !== base.appId
    || order.orderType !== base.orderType || order.meta?.productId !== base.meta.productId
    || order.meta?.environment !== base.meta.environment
    || (order.meta?.bundleId && order.meta.bundleId !== base.meta.bundleId)
    || (order.orderType === 'membership' && (
      order.billingCycle !== base.billingCycle || (order.level || order.planId) !== base.level
      || order.providerPurchasedAt !== base.providerPurchasedAt
    ))
    || (order.orderType === 'recharge_coin' && order.coinAmount !== base.coinAmount)
  ) {
    throw new Error('IAP 交易与已有订单不一致')
  }
}

async function findMembership(db, userId) {
  const collection = db.collection(MEMBERSHIPS_COLLECTION)
  const canonical = await readDoc(collection.doc(userId))
  if (canonical) {
    if (canonical.userId && canonical.userId !== userId)
      throw new Error('IAP 会员文档归属异常')
    return { ...canonical, _id: userId }
  }
  const result = await collection.where({ userId }).limit(2).get()
  assertResult(result)
  const legacy = Array.isArray(result?.data) ? result.data : []
  if (legacy.length > 1)
    throw new Error('IAP 历史会员文档重复，需人工核对')
  return legacy[0] || null
}

async function grantMembership(transaction, order, knownMembership, now) {
  const canonicalRef = transaction.collection(MEMBERSHIPS_COLLECTION).doc(order.userId)
  const canonical = await readDoc(canonicalRef)
  const legacy = !canonical && knownMembership?._id && knownMembership._id !== order.userId
    ? await readDoc(transaction.collection(MEMBERSHIPS_COLLECTION).doc(knownMembership._id))
    : null
  const current = canonical || legacy
  if ((current?.userId && current.userId !== order.userId) || (knownMembership && !current))
    throw new Error('IAP 会员文档归属或状态发生变化')

  // 旧 paid 订单不一定已完成发放。lastOrderId 仅能证明最后一笔，不能证明更早记录。
  if (order.status === 'paid') {
    if (current?.lastOrderId !== order.outTradeNo || !Number.isFinite(current.expireAt))
      throw new Error('IAP 历史会员订单缺少发放凭据，需人工核对')
    return {
      grant: { planId: current.planId, cycle: current.activeCycle, expireAt: current.expireAt },
      membershipGrant: null, // 不伪造购买前快照，退款仍转人工核对。
    }
  }
  if (current?.lastOrderId === order.outTradeNo)
    throw new Error('IAP 待付款订单与会员凭据状态不一致')

  const period = computeNewMembershipPeriod({
    current: current?.expireAt,
    cycle: order.billingCycle,
    now: order.providerPurchasedAt,
    billingAnchorDay: current?.billingAnchorDay,
    billingAnchorIsMonthEnd: current?.billingAnchorIsMonthEnd,
  })
  const { _id: _membershipId, userId: _legacyUserId, ...preserved } = current || {}
  await setDoc(canonicalRef, {
    ...preserved,
    planId: order.level || order.planId,
    activeCycle: order.billingCycle,
    ...period,
    lastOrderId: order.outTradeNo,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  })
  return {
    grant: { planId: order.level || order.planId, cycle: order.billingCycle, ...period },
    membershipGrant: {
      expireBefore: Number.isFinite(current?.expireAt) ? current.expireAt : null,
      expireAfter: period.expireAt,
      billingAnchorDayBefore: Number.isInteger(current?.billingAnchorDay) ? current.billingAnchorDay : null,
      billingAnchorIsMonthEndBefore: typeof current?.billingAnchorIsMonthEnd === 'boolean' ? current.billingAnchorIsMonthEnd : null,
      activeCycleBefore: current?.activeCycle || null,
      planIdBefore: current?.planId || null,
      levelBefore: current?.level || null,
      lastOrderIdBefore: current?.lastOrderId || null,
    },
  }
}

/**
 * 新订单使用稳定文档 ID；历史随机 ID 只在事务外定位，事务内重新校验。
 * 没有额外集合，也不修改 / 合并有歧义的历史重复订单。
 * 部署时须排空旧版 IAP 写入，并同步升级微信侧补发入口的 IAP 拒绝保护。
 */
async function settleIapOrder(db, base, now) {
  const query = await db.collection(ORDERS_COLLECTION).where({ outTradeNo: base.outTradeNo }).limit(2).get()
  assertResult(query)
  const matches = Array.isArray(query?.data) ? query.data : []
  if (matches.length > 1)
    throw new Error('IAP 存在重复订单，需人工核对')
  const knownOrder = matches[0]
  assertOrderMatch(knownOrder, base)
  const knownMembership = base.orderType === 'membership' ? await findMembership(db, base.userId) : null
  const coinInput = {
    userId: base.userId,
    appId: base.appId,
    amount: base.coinAmount,
    type: 'recharge',
    refId: base.outTradeNo,
    meta: { packId: base.packId || '' },
    now,
  }
  const preparedCoin = base.orderType === 'recharge_coin' ? await prepareCoinCredit(db, coinInput) : null
  let outcome
  const committed = await db.runTransaction(async (transaction) => {
    const canonicalRef = transaction.collection(ORDERS_COLLECTION).doc(base.outTradeNo)
    const canonical = await readDoc(canonicalRef)
    const legacy = knownOrder?._id && knownOrder._id !== base.outTradeNo
      ? await readDoc(transaction.collection(ORDERS_COLLECTION).doc(knownOrder._id))
      : null
    if (canonical && legacy)
      throw new Error('IAP 存在重复订单，需人工核对')
    if (knownOrder && !canonical && !legacy)
      throw new Error('IAP 历史订单发生变化，需重新核对')
    const existing = canonical || legacy
    assertOrderMatch(existing, base)
    const order = existing || base
    if (order.status === 'refunded' || (order.status === 'paid' && Number.isFinite(order.grantedAt))) {
      outcome = { granted: false, alreadyProcessed: true, outTradeNo: base.outTradeNo }
      return outcome
    }
    if (!['pending', 'paid'].includes(order.status))
      throw new Error('IAP 订单状态不允许发放')

    let grant
    let membershipGrant
    if (order.orderType === 'membership') {
      ({ grant, membershipGrant } = await grantMembership(transaction, order, knownMembership, now))
    }
    else {
      grant = await creditCoinInTransaction(transaction, coinInput, preparedCoin)
    }
    const orderRef = legacy ? transaction.collection(ORDERS_COLLECTION).doc(knownOrder._id) : canonicalRef
    await setDoc(orderRef, {
      ...order,
      status: 'paid',
      paidAt: order.paidAt ?? now,
      grantedAt: now,
      updatedAt: now,
      iapSettlementVersion: 1,
      ...(membershipGrant ? { membershipGrant } : {}),
    })
    outcome = { granted: true, grant, outTradeNo: base.outTradeNo }
    return outcome
  })
  assertResult(committed)
  if (!outcome)
    throw new Error('IAP 事务未返回发放结果')
  return outcome
}

module.exports = { assertPurchaseOwner, purchaseAccountToken, settleIapOrder }
