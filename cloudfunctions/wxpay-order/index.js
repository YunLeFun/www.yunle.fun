/**
 * 云函数 wxpay-order
 *
 * 路由 action：
 *   - createOrder      创建套餐订单（需登录）
 *   - createTestOrder  自定义金额测试下单（默认禁用，需 WX_ALLOW_TEST_ORDER=true 才启用）
 *   - queryOrder       查询订单（本地状态 + 微信兜底）
 *   - adminRequestMembershipRefund owner 发起 7 天内会员全额退款（需内部服务令牌）
 *   - adminQueryMembershipRefund owner 主动查询并补偿退款结果（需内部服务令牌）
 *
 * 主入口只做"参数解析 + 鉴权 + 路由"，纯逻辑全部委托给 lib/。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { assertActiveAccountForUid } = require('./account-access')

const { generateNonceStr, generateOutTradeNo } = require('./lib/crypto')
const { generateJsapiPayParams } = require('./lib/jsapi')
const {
  findOrderByOutTradeNo,
  grantOrderEntitlement,
  markOrderPaid,
  ORDERS_COLLECTION,
} = require('./lib/orders')
const { getCoinPack, getCustomCoinPlan, getMembershipAmount } = require('./lib/plans')
const {
  queryMembershipRefundForAdmin,
  requestMembershipRefundForAdmin,
} = require('./lib/refund-service')
const {
  assertSyntheticOrderAllowed,
  classifySyntheticOrderAccount,
  createSyntheticOrder,
} = require('./lib/synthetic-order')
const {
  assertMembershipOrderInput,
  assertOutTradeNo,
  assertRechargeCoinInput,
  assertTestAmount,
} = require('./lib/validation')
const { queryTransactionByOutTradeNo, wxpayRequest } = require('./lib/wxpay-client')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

function assertActiveAccount(uid) {
  return assertActiveAccountForUid(callAccountApi, {
    serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    userId: uid,
  })
}

/** 必要环境变量校验（运行时） */
function loadConfig() {
  const cfg = {
    appId: process.env.WX_APPID,
    mchId: process.env.WX_MCH_ID,
    serialNo: process.env.WX_SERIAL_NO,
    privateKey: process.env.WX_PRIVATE_KEY,
    notifyUrl: process.env.WX_NOTIFY_URL,
    refundNotifyUrl: process.env.WX_REFUND_NOTIFY_URL || process.env.WX_NOTIFY_URL,
    allowTestOrder: process.env.WX_ALLOW_TEST_ORDER === 'true',
  }
  const missing = ['appId', 'mchId', 'serialNo', 'privateKey', 'notifyUrl']
    .filter(k => !cfg[k])
  if (missing.length > 0) {
    throw new Error(`微信支付配置缺失：${missing.join(', ')}`)
  }
  return cfg
}

function timingSafeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string')
    return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function assertInternalServiceToken(token) {
  const expected = process.env.ACCOUNT_API_INTERNAL_TOKEN || ''
  if (!expected)
    throw new Error('内部服务鉴权未配置')
  if (!timingSafeEqualString(token, expected))
    throw new Error('内部服务鉴权失败')
}

/**
 * 匿名 / 占位身份集合。CloudBase 在「仅用公开 accessKey、未真正登录」时
 * 会以匿名身份调用云函数，getUserInfo().uid 可能为空或 'anon'。
 * 这类身份绝不能用于下单 / 发放权益，否则真实付款会落到共享占位账户上。
 */
const ANON_UIDS = new Set(['', 'anon'])

/** 当前调用者 uid（CloudBase Auth）；匿名 / 占位身份一律视为未登录返回 '' */
function getCallerUid() {
  try {
    const auth = app.auth()
    const info = auth.getUserInfo()
    const uid = info?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function buildOrderParams({ cfg, amount, outTradeNo, description }) {
  return {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description,
    out_trade_no: outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: amount, currency: 'CNY' },
  }
}

/** 根据支付方式实际调用对应的下单接口 */
async function callPrepay({ cfg, payType, orderParams, payerOpenid, clientIp }) {
  const wxClient = {
    mchId: cfg.mchId,
    serialNo: cfg.serialNo,
    privateKey: cfg.privateKey,
  }
  if (payType === 'native') {
    return wxpayRequest(wxClient, {
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      body: orderParams,
    })
  }
  if (payType === 'jsapi') {
    if (!payerOpenid)
      throw new Error('JSAPI 支付需要微信 openid')
    return wxpayRequest(wxClient, {
      method: 'POST',
      urlPath: '/v3/pay/transactions/jsapi',
      body: { ...orderParams, payer: { openid: payerOpenid } },
    })
  }
  if (payType === 'h5') {
    return wxpayRequest(wxClient, {
      method: 'POST',
      urlPath: '/v3/pay/transactions/h5',
      body: {
        ...orderParams,
        scene_info: {
          payer_client_ip: clientIp || '127.0.0.1',
          h5_info: { type: 'Wap' },
        },
      },
    })
  }
  throw new Error(`不支持的支付方式: ${payType}`)
}

function buildPayResult({ payType, cfg, wxResult, outTradeNo }) {
  const result = { outTradeNo, payType }
  if (payType === 'native') {
    result.codeUrl = wxResult.code_url
  }
  else if (payType === 'h5') {
    result.h5Url = wxResult.h5_url
  }
  else if (payType === 'jsapi') {
    result.jsapiParams = generateJsapiPayParams({
      appId: cfg.appId,
      prepayId: wxResult.prepay_id,
      privateKey: cfg.privateKey,
      timestamp: String(nowSeconds()),
      nonceStr: generateNonceStr(),
    })
  }
  return result
}

/** 默认应用标识：历史前端不传 appId 时归属到云乐坊主站 */
const DEFAULT_APP_ID = 'yunle'

/**
 * 解析下单入参，按 orderType 算出金额、描述与落库字段。
 * 默认 orderType=membership、appId=yunle 以兼容历史前端。
 */
function resolveOrderPlan(rawEvent) {
  // 缺省 appId 归属主站，兼容历史调用
  const event = { ...rawEvent, appId: rawEvent.appId || DEFAULT_APP_ID }
  const orderType = event.orderType || 'membership'

  if (orderType === 'membership') {
    const { appId, level, billingCycle, payType, wxOpenid } = assertMembershipOrderInput(event)
    const amount = getMembershipAmount(level, billingCycle)
    return {
      orderType,
      appId,
      payType,
      wxOpenid,
      amount,
      description: `云乐坊 ${level} 会员 - ${billingCycle === 'month' ? '月付' : '年付'}`,
      // 落库字段（含旧 planId 以兼容现有 user_memberships 读取）
      orderFields: { appId, orderType, level, planId: level, billingCycle },
    }
  }

  if (orderType === 'recharge_coin') {
    const { appId, packId, coin, payType, wxOpenid } = assertRechargeCoinInput(event)
    // 预设套餐走 getCoinPack（含汇率守恒校验）；自定义数量走 getCustomCoinPlan（含范围校验）。
    // 两条路径金额均由服务端计算，绝不信任前端传入的金额。
    const pack = packId ? getCoinPack(packId) : getCustomCoinPlan(coin)
    return {
      orderType,
      appId,
      payType,
      wxOpenid,
      amount: pack.amount,
      description: `云乐坊 云币充值 ${pack.coin} 云币`,
      orderFields: { appId, orderType, packId: packId || 'custom', coinAmount: pack.coin },
    }
  }

  throw new Error(`未知 orderType: ${orderType}`)
}

async function handleCreateOrder(event) {
  const uid = getCallerUid()
  if (!uid)
    throw new Error('请先登录后再下单')
  await assertActiveAccount(uid)

  const { payType, wxOpenid, amount, description, orderFields } = resolveOrderPlan(event)
  const outTradeNo = generateOutTradeNo()
  const classification = await classifySyntheticOrderAccount(db, uid)
  assertSyntheticOrderAllowed(classification)
  if (classification.synthetic) {
    return createSyntheticOrder(db, {
      amount,
      identity: classification.identity,
      now: Date.now(),
      orderFields,
      outTradeNo,
      requestedPayType: payType,
      userId: uid,
    })
  }

  const cfg = loadConfig()
  const orderParams = buildOrderParams({ cfg, amount, outTradeNo, description })

  // 先落 pending 订单，再向微信下单：即使后续 prepay 失败，也只是留下一条可对账关闭的废单，
  // 绝不会出现"用户已付款但本地无订单"（回调会因查无订单而漏发权益、造成资损）。
  const now = Date.now()
  await db.collection(ORDERS_COLLECTION).add({
    userId: uid,
    ...orderFields,
    amount,
    payType,
    status: 'pending',
    outTradeNo,
    createdAt: now,
    updatedAt: now,
  })

  let wxResult
  try {
    wxResult = await callPrepay({
      cfg,
      payType,
      orderParams,
      payerOpenid: wxOpenid,
      clientIp: event.clientIp,
    })
  }
  catch (err) {
    // 下单失败：把刚落库的 pending 订单标记为 failed，避免悬挂占用对账配额
    await db.collection(ORDERS_COLLECTION)
      .where({ outTradeNo, status: 'pending' })
      .update({ status: 'failed', updatedAt: Date.now() })
    throw err
  }

  // 回写微信下单返回的支付参数
  await db.collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .update({
      codeUrl: wxResult.code_url || '',
      h5Url: wxResult.h5_url || '',
      prepayId: wxResult.prepay_id || '',
      updatedAt: Date.now(),
    })

  return buildPayResult({ payType, cfg, wxResult, outTradeNo })
}

async function handleCreateTestOrder(event) {
  const uid = getCallerUid()
  if (!uid)
    throw new Error('请先登录后再下单')
  await assertActiveAccount(uid)

  const classification = await classifySyntheticOrderAccount(db, uid)
  if (classification.synthetic)
    throw new Error('固定测试账号请使用正常下单入口创建合成订单')

  const cfg = loadConfig()
  if (!cfg.allowTestOrder)
    throw new Error('测试下单已禁用，请设置 WX_ALLOW_TEST_ORDER=true')

  const amount = assertTestAmount(event.amount)
  const payType = event.payType
  if (!['native', 'jsapi', 'h5'].includes(payType))
    throw new Error(`不支持的支付方式: ${payType}`)

  const outTradeNo = generateOutTradeNo()
  const orderParams = buildOrderParams({
    cfg,
    amount,
    outTradeNo,
    description: event.description || `云乐坊测试支付 ${(amount / 100).toFixed(2)} 元`,
  })

  // 同 handleCreateOrder：先落库后 prepay，避免"已付款无订单"
  const now = Date.now()
  await db.collection(ORDERS_COLLECTION).add({
    userId: uid,
    planId: 'test',
    billingCycle: 'once',
    amount,
    payType,
    status: 'pending',
    outTradeNo,
    createdAt: now,
    updatedAt: now,
  })

  let wxResult
  try {
    wxResult = await callPrepay({
      cfg,
      payType,
      orderParams,
      payerOpenid: event.wxOpenid,
      clientIp: event.clientIp,
    })
  }
  catch (err) {
    await db.collection(ORDERS_COLLECTION)
      .where({ outTradeNo, status: 'pending' })
      .update({ status: 'failed', updatedAt: Date.now() })
    throw err
  }

  await db.collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .update({
      codeUrl: wxResult.code_url || '',
      h5Url: wxResult.h5_url || '',
      prepayId: wxResult.prepay_id || '',
      updatedAt: Date.now(),
    })

  return buildPayResult({ payType, cfg, wxResult, outTradeNo })
}

/**
 * 结算单笔 pending 订单：主动查微信 → 命中成功则标 paid 并发放权益。
 *
 * 供 queryOrder（前端轮询）与 reconcileOrders（兜底对账）复用，保证「查单 → 发放」逻辑只有一处。
 * 微信确认成功后必须等权益发放完成才向客户端返回 paid；即使支付回调抢先完成了状态更新，
 * 也会依靠会员 lastOrderId / 云币 refId 幂等键安全地等待或补发权益。
 *
 * @param {object} cfg loadConfig() 结果
 * @param {object} order pending 订单文档
 * @returns {Promise<{ status: string, transactionId: string|null, paidAt: number|null }>}
 */
async function settlePendingOrder(cfg, order) {
  const outTradeNo = order.outTradeNo
  let tx
  try {
    tx = await queryTransactionByOutTradeNo(
      {
        mchId: cfg.mchId,
        serialNo: cfg.serialNo,
        privateKey: cfg.privateKey,
      },
      { outTradeNo, mchId: cfg.mchId },
    )
  }
  catch (err) {
    // 查询失败不影响前端，仍返回 pending
    console.warn('[wxpay-order] 主动查询微信失败:', err.message)
    return { status: 'pending', transactionId: null, paidAt: null }
  }

  if (tx?.trade_state === 'SUCCESS') {
    // 业务校验：appid / mchid / amount
    if (
      tx.appid !== cfg.appId
      || tx.mchid !== cfg.mchId
      || tx?.amount?.total !== order.amount
    ) {
      console.error('[wxpay-order] 查询结果与订单不匹配:', { outTradeNo })
      return { status: order.status, transactionId: null, paidAt: null }
    }
    const now = Date.now()
    const { updated } = await markOrderPaid(db, {
      outTradeNo,
      transactionId: tx.transaction_id,
      now,
    })
    let paidOrder = order
    if (updated === 0) {
      const latestOrder = await findOrderByOutTradeNo(db, outTradeNo)
      if (!latestOrder || latestOrder.status !== 'paid') {
        return {
          status: latestOrder?.status || 'pending',
          transactionId: latestOrder?.transactionId || null,
          paidAt: latestOrder?.paidAt || null,
        }
      }
      paidOrder = latestOrder
    }
    try {
      await grantOrderEntitlement(db, { order: paidOrder, now })
    }
    catch (err) {
      console.error('[wxpay-order] 兜底发放权益失败，将继续轮询:', err.message)
      return { status: 'pending', transactionId: tx.transaction_id, paidAt: now }
    }
    return { status: 'paid', transactionId: tx.transaction_id, paidAt: now }
  }

  if (tx?.trade_state === 'CLOSED' || tx?.trade_state === 'PAYERROR' || tx?.trade_state === 'REVOKED') {
    const now = Date.now()
    await db.collection(ORDERS_COLLECTION)
      .where({ outTradeNo, status: 'pending' })
      .update({ status: tx.trade_state === 'CLOSED' ? 'closed' : 'failed', updatedAt: now })
    return { status: tx.trade_state === 'CLOSED' ? 'closed' : 'failed', transactionId: null, paidAt: null }
  }

  return { status: 'pending', transactionId: null, paidAt: null }
}

async function handleQueryOrder(event) {
  const uid = getCallerUid()
  if (!uid)
    throw new Error('请先登录')

  const outTradeNo = assertOutTradeNo(event.outTradeNo)
  const order = await findOrderByOutTradeNo(db, outTradeNo)
  if (!order)
    throw new Error('订单不存在')
  if (order.userId !== uid)
    throw new Error('无权访问该订单')

  if (order.synthetic === true) {
    return {
      status: 'synthetic',
      synthetic: true,
      transactionId: null,
      paidAt: null,
    }
  }

  // 支付回调会先把订单标为 paid，再发放会员/云币权益。前端轮询可能恰好落在两步之间：
  // 如果此时直接返回 paid，客户端会停止轮询并只刷新一次尚未更新的账户状态。
  // 因此 paid 只有在权益已发放后才作为客户端终态返回；发放失败时保持轮询，
  // 下一次 queryOrder 会继续依靠底层幂等键补发。
  if (order.status !== 'pending') {
    if (order.status === 'paid' && !order.grantedAt) {
      try {
        await grantOrderEntitlement(db, { order, now: Date.now() })
      }
      catch (err) {
        console.error('[wxpay-order] 查单时补发权益失败，将继续轮询:', {
          outTradeNo,
          err: err.message,
        })
        return {
          status: 'pending',
          transactionId: order.transactionId || null,
          paidAt: order.paidAt || null,
        }
      }
    }
    return {
      status: order.status,
      transactionId: order.transactionId || null,
      paidAt: order.paidAt || null,
    }
  }

  // pending：主动查微信兜底
  const cfg = loadConfig()
  return settlePendingOrder(cfg, order)
}

/** reconcileOrders 单次最多对账的订单数（防止恶意刷大量 pending 拖垮函数） */
const RECONCILE_MAX_ORDERS = 20

/**
 * 兜底对账：把当前用户最近的 pending 订单逐一向微信核对并补发权益。
 *
 * 解决「支付成功但前端轮询窗口已关闭 / 异步回调漏达」导致订单长期卡在 pending、
 * 权益迟迟未发放的问题。前端进入钱包页时调用一次即可自愈。
 */
async function handleReconcile() {
  const uid = getCallerUid()
  if (!uid)
    throw new Error('请先登录')

  const classification = await classifySyntheticOrderAccount(db, uid)
  assertSyntheticOrderAllowed(classification)
  if (classification.synthetic)
    return { reconciled: 0, paid: 0, regranted: 0 }

  const cfg = loadConfig()

  // 1. pending 订单：向微信核对，命中成功则标 paid 并发放权益
  const { data } = await db
    .collection(ORDERS_COLLECTION)
    .where({ userId: uid, status: 'pending' })
    .orderBy('createdAt', 'desc')
    .limit(RECONCILE_MAX_ORDERS)
    .get()
  const pending = Array.isArray(data) ? data : []
  let paid = 0
  for (const order of pending) {
    try {
      const res = await settlePendingOrder(cfg, order)
      if (res.status === 'paid')
        paid++
    }
    catch (err) {
      // 单笔失败不阻断其余订单对账
      console.warn('[wxpay-order] 对账单笔失败:', order.outTradeNo, err.message)
    }
  }

  // 2. 自愈：已 paid 但权益未发放的订单（回调在 markPaid 之后、grant 之前中断，或 grant 抛错）。
  //    这类订单 status 已是 paid，settlePendingOrder 不会再处理它们，必须单独补发。
  //    grantOrderEntitlement 自带幂等（会员 lastOrderId / 云币 refId / 订单 grantedAt），重入安全。
  const { data: paidData } = await db
    .collection(ORDERS_COLLECTION)
    .where({ userId: uid, status: 'paid' })
    .orderBy('createdAt', 'desc')
    .limit(RECONCILE_MAX_ORDERS)
    .get()
  const ungranted = (Array.isArray(paidData) ? paidData : []).filter(o => !o.grantedAt)
  let regranted = 0
  for (const order of ungranted) {
    try {
      await grantOrderEntitlement(db, { order, now: Date.now() })
      regranted++
    }
    catch (err) {
      console.error('[wxpay-order] 自愈补发失败（需人工介入）:', order.outTradeNo, err.message)
    }
  }

  return { reconciled: pending.length, paid, regranted }
}

async function handleAdminRequestMembershipRefund(event) {
  assertInternalServiceToken(event?.serviceToken)
  await assertNonSyntheticRefundOrder(event?.outTradeNo)
  const cfg = loadConfig()
  return requestMembershipRefundForAdmin(db, {
    outTradeNo: event?.outTradeNo,
    operator: event?.operator,
    reason: event?.reason,
    config: cfg,
    now: Date.now(),
  })
}

async function handleAdminQueryMembershipRefund(event) {
  assertInternalServiceToken(event?.serviceToken)
  await assertNonSyntheticRefundOrder(event?.outTradeNo)
  const cfg = loadConfig()
  return queryMembershipRefundForAdmin(db, {
    outTradeNo: event?.outTradeNo,
    config: cfg,
    now: Date.now(),
  })
}

async function assertNonSyntheticRefundOrder(rawOutTradeNo) {
  const outTradeNo = assertOutTradeNo(rawOutTradeNo)
  const order = await findOrderByOutTradeNo(db, outTradeNo)
  if (order?.synthetic === true)
    throw new Error('合成订单不允许请求微信退款')
}

exports.main = async (event) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'createOrder':
        return await handleCreateOrder(event)
      case 'createTestOrder':
        return await handleCreateTestOrder(event)
      case 'queryOrder':
        return await handleQueryOrder(event)
      case 'reconcileOrders':
        return await handleReconcile()
      case 'adminRequestMembershipRefund':
        return await handleAdminRequestMembershipRefund(event)
      case 'adminQueryMembershipRefund':
        return await handleAdminQueryMembershipRefund(event)
      default:
        throw new Error(`未知 action: ${action}`)
    }
  }
  catch (err) {
    console.error('[wxpay-order] 处理失败:', err.message)
    throw err
  }
}
