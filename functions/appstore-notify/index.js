/**
 * 云函数 appstore-notify —— 接收 App Store Server Notifications V2。
 *
 * HTTP 触发（CloudBase HTTP 访问服务绑定路径，URL 配置到 App Store Connect）。
 *
 * 安全模型：通知体的 signedPayload 先解码提取 transactionId（不信任内容），
 * 再通过 TLS 直连 App Store Server API 回查权威交易数据，确认后才处理，
 * 杜绝伪造回调（见 lib/appstore.js 注释）。
 *
 * 处理的通知类型：
 *   - REFUND / REVOKE：订单标记 refunded；会员订单立即失效；云币订单记录日志待人工追回
 *   - 其他类型（CONSUMPTION_REQUEST、TEST 等）：仅记录日志，返回 200
 *
 * 环境变量同 iap-order（APPSTORE_ISSUER_ID / APPSTORE_KEY_ID / APPSTORE_PRIVATE_KEY / APPSTORE_BUNDLE_ID）。
 *
 * lib/ 由 `pnpm sync:wxpay-lib` 从 functions/wxpay-order/lib 同步，禁止直接修改本目录的 lib。
 */

'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { decodeJwsPayload, getTransactionInfo } = require('./lib/appstore')
const { handleIapRefund } = require('./lib/iap')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

/** 需要处理退款逻辑的通知类型 */
const REFUND_NOTIFICATION_TYPES = new Set(['REFUND', 'REVOKE'])

function loadConfig() {
  const cfg = {
    issuerId: process.env.APPSTORE_ISSUER_ID,
    keyId: process.env.APPSTORE_KEY_ID,
    privateKeyPem: process.env.APPSTORE_PRIVATE_KEY,
    bundleId: process.env.APPSTORE_BUNDLE_ID || 'fun.yunle.apps',
  }
  const missing = []
  if (!cfg.issuerId)
    missing.push('APPSTORE_ISSUER_ID')
  if (!cfg.keyId)
    missing.push('APPSTORE_KEY_ID')
  if (!cfg.privateKeyPem)
    missing.push('APPSTORE_PRIVATE_KEY')
  if (missing.length > 0)
    throw new Error(`appstore-notify 配置缺失: ${missing.join(', ')}`)
  return cfg
}

function httpResponse(statusCode, body) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** 解析 HTTP 触发的请求体（兼容 base64 与直传 JSON） */
function parseBody(event) {
  let raw = event?.body
  if (!raw)
    return null
  if (event.isBase64Encoded)
    raw = Buffer.from(raw, 'base64').toString('utf8')
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  catch {
    return null
  }
}

exports.main = async (event) => {
  let config
  try {
    config = loadConfig()
  }
  catch (err) {
    console.error('[appstore-notify] 启动配置错误:', err.message)
    return httpResponse(500, { message: '服务未配置' })
  }

  if (event?.httpMethod && event.httpMethod !== 'POST')
    return httpResponse(405, { message: 'Method Not Allowed' })

  const body = parseBody(event)
  if (!body?.signedPayload)
    return httpResponse(400, { message: 'signedPayload 缺失' })

  try {
    // 1. 解码通知（不信任内容，仅用于提取类型与 transactionId）
    const notification = decodeJwsPayload(body.signedPayload)
    const { notificationType, subtype } = notification
    console.warn(`[appstore-notify] 收到通知: ${notificationType}${subtype ? `/${subtype}` : ''}`)

    if (!REFUND_NOTIFICATION_TYPES.has(notificationType)) {
      // TEST / CONSUMPTION_REQUEST 等：记录后直接确认
      return httpResponse(200, { ok: true })
    }

    const signedTx = notification.data?.signedTransactionInfo
    if (!signedTx) {
      console.warn('[appstore-notify] 通知缺少 signedTransactionInfo')
      return httpResponse(200, { ok: true })
    }
    const claimed = decodeJwsPayload(signedTx)

    // 2. 回查 Server API 取权威数据（防伪造）
    const { payload } = await getTransactionInfo({
      transactionId: String(claimed.transactionId),
      config,
    })
    if (payload.bundleId !== config.bundleId) {
      console.warn(`[appstore-notify] bundleId 不匹配: ${payload.bundleId}`)
      return httpResponse(200, { ok: true })
    }
    // 退款通知必须以 Apple 侧的撤销状态为准
    if (!payload.revocationDate) {
      console.warn(`[appstore-notify] 交易未被撤销，忽略退款通知: ${payload.transactionId}`)
      return httpResponse(200, { ok: true })
    }

    // 3. 处理退款（幂等）
    const result = await handleIapRefund(db, { payload, now: Date.now() })
    console.warn(`[appstore-notify] 退款处理结果:`, JSON.stringify(result))
    return httpResponse(200, { ok: true })
  }
  catch (err) {
    // 返回非 2xx 让 Apple 重试（瞬时错误自愈）
    console.error('[appstore-notify] 处理失败:', err.message)
    return httpResponse(500, { message: '处理失败' })
  }
}
