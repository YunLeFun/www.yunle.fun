/**
 * 微信支付回调处理 handler（依赖注入式纯函数）。
 *
 * 把"验签 -> 解密 -> 校验 -> 更新订单 -> 开通会员"的整条状态机抽到这里，
 * 使其可被 vitest 用 mock db 完整测试，避免依赖云函数运行时。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { decryptResource } = require('./crypto')
const {
  findOrderByOutTradeNo,
  grantOrderEntitlement,
  markOrderPaid,
} = require('./orders')
const { verifyCallbackSignature } = require('./signature')
const { assertResourceMatchesOrder } = require('./validation')

/**
 * 将 header 名统一转为小写
 * @param {Record<string,string>|undefined} raw
 * @returns {Record<string,string>}
 */
function lowercaseHeaders(raw) {
  const out = {}
  if (!raw)
    return out
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = value
  }
  return out
}

/**
 * 序列化 event.body 为字符串（验签必须用原始字符串）
 * @param {string|object|undefined} body
 * @returns {string}
 */
function stringifyBody(body) {
  if (typeof body === 'string')
    return body
  if (body == null)
    return ''
  return JSON.stringify(body)
}

/**
 * 构造云函数 HTTP 响应（微信回调期望 200/json）
 *
 * @param {number} statusCode
 * @param {string} code  'SUCCESS' | 'FAIL'
 * @param {string} message
 */
function buildResponse(statusCode, code, message) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, message }),
  }
}

/**
 * 处理一次微信支付回调
 *
 * @param {object} input
 * @param {object} input.event  云函数 HTTP 触发器 event
 * @param {object} input.db CloudBase database
 * @param {object} input.config
 * @param {Record<string,string>} input.config.certificates serial -> PEM
 * @param {string} input.config.apiV3Key
 * @param {string} input.config.expectedAppid
 * @param {string} input.config.expectedMchid
 * @param {number} [input.config.toleranceSeconds]
 * @param {() => number} [input.config.now] 用于测试注入时间
 * @returns {Promise<object>} HTTP 响应对象
 */
async function handleNotify({ event, db, config }) {
  const headers = lowercaseHeaders(event?.headers)
  const body = stringifyBody(event?.body)
  const now = config.now ? config.now() : Date.now()

  // 1. 验签
  const verifyResult = verifyCallbackSignature({
    certificates: config.certificates,
    serial: headers['wechatpay-serial'],
    timestamp: headers['wechatpay-timestamp'],
    nonce: headers['wechatpay-nonce'],
    signature: headers['wechatpay-signature'],
    body,
    toleranceSeconds: config.toleranceSeconds ?? 300,
    nowSeconds: Math.floor(now / 1000),
  })
  if (!verifyResult.ok) {
    console.error('[wxpay-notify] 验签失败:', verifyResult.reason)
    return buildResponse(401, 'FAIL', '签名验证失败')
  }

  // 2. 解析事件
  let notification
  try {
    notification = JSON.parse(body)
  }
  catch {
    return buildResponse(400, 'FAIL', '无法解析回调内容')
  }

  // 忽略非支付成功事件（如退款、其他事件）但要返回 200 防止微信重发
  if (notification.event_type !== 'TRANSACTION.SUCCESS') {
    console.warn('[wxpay-notify] 忽略非支付成功事件:', notification.event_type)
    return buildResponse(200, 'SUCCESS', '已接收')
  }

  // 3. 解密 resource
  let resource
  try {
    resource = decryptResource({ resource: notification.resource, apiV3Key: config.apiV3Key })
  }
  catch (err) {
    console.error('[wxpay-notify] 解密失败:', err.message)
    return buildResponse(500, 'FAIL', '解密失败')
  }

  if (resource.trade_state !== 'SUCCESS') {
    console.warn('[wxpay-notify] 交易状态非成功:', resource.trade_state)
    return buildResponse(200, 'SUCCESS', '已接收')
  }

  // 4. 找到订单
  const order = await findOrderByOutTradeNo(db, resource.out_trade_no)
  if (!order) {
    // 未找到本地订单：可能是攻击 / 误传，返回 200 防止微信无限重试
    console.error('[wxpay-notify] 未找到订单:', resource.out_trade_no)
    return buildResponse(200, 'SUCCESS', '订单不存在')
  }

  // 5. 业务字段校验
  try {
    assertResourceMatchesOrder({
      resource,
      order,
      expectedAppid: config.expectedAppid,
      expectedMchid: config.expectedMchid,
    })
  }
  catch (err) {
    console.error('[wxpay-notify] 校验失败:', err.message, {
      outTradeNo: order.outTradeNo,
    })
    // 业务字段不匹配视为伪造/异常，返回 401 让微信记录
    return buildResponse(401, 'FAIL', err.message)
  }

  // 6. 原子标记为 paid
  let updated
  try {
    ;({ updated } = await markOrderPaid(db, {
      outTradeNo: order.outTradeNo,
      transactionId: resource.transaction_id,
      now,
    }))
  }
  catch (err) {
    console.error('[wxpay-notify] 更新订单失败:', err.message)
    return buildResponse(500, 'FAIL', '处理失败')
  }

  if (updated === 0) {
    // 已被处理过：幂等返回成功
    console.warn('[wxpay-notify] 订单已支付，跳过开通:', order.outTradeNo)
    return buildResponse(200, 'SUCCESS', '幂等成功')
  }

  // 7. 发放权益（会员开通 / 云币入账，按 orderType 分支）
  try {
    await grantOrderEntitlement(db, { order, now })
  }
  catch (err) {
    // 发放失败：订单已 paid，但用户没拿到权益
    // 微信会重试此回调，但 markOrderPaid 会返回 updated=0
    // -> 留下错误日志，需要人工补偿；不能 throw，否则微信反复重试
    console.error('[wxpay-notify] 权益发放失败（需人工补偿）:', {
      outTradeNo: order.outTradeNo,
      userId: order.userId,
      orderType: order.orderType || 'membership',
      err: err.message,
    })
    return buildResponse(200, 'SUCCESS', '订单已确认，权益发放失败需人工处理')
  }

  console.warn('[wxpay-notify] 订单已确认 & 权益已发放:', order.outTradeNo)
  return buildResponse(200, 'SUCCESS', '成功')
}

module.exports = {
  handleNotify,
  lowercaseHeaders,
  stringifyBody,
  buildResponse,
}
