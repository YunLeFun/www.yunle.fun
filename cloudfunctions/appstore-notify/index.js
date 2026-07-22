/**
 * 云函数 appstore-notify —— 接收 App Store Server Notifications V2。
 *
 * HTTP 触发（CloudBase HTTP 访问服务绑定路径，URL 配置到 App Store Connect）。
 *
 * 安全模型：signedPayload 用 Apple 官方库本地验签（证书链锚定 Apple 根证书），
 * 验签失败直接拒绝——无需回查 Server API 即可杜绝伪造回调（见 lib/appstore.js 注释）。
 *
 * 处理的通知类型：
 *   - REFUND / REVOKE：订单标记 refunded；会员订单按发放快照安全回滚，无法可靠回滚时
 *     转人工复核；云币订单自动追回未消费余额（扣到零封顶，差额计损记日志）
 *   - 其他类型（CONSUMPTION_REQUEST、TEST 等）：仅记录日志，返回 200
 *
 * 环境变量同 iap-order（APPSTORE_ISSUER_ID / APPSTORE_KEY_ID / APPSTORE_PRIVATE_KEY /
 * APPSTORE_BUNDLE_ID / APPSTORE_APP_APPLE_ID）。
 *
 * lib/ 由 `pnpm sync:wxpay-lib` 从 cloudfunctions/wxpay-order/lib 同步，禁止直接修改本目录的 lib。
 */

'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { createAppStoreService } = require('./lib/appstore')
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
    appAppleId: process.env.APPSTORE_APP_APPLE_ID
      ? Number(process.env.APPSTORE_APP_APPLE_ID)
      : undefined,
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

/** App Store 服务（云函数实例存活期间复用） */
let appstoreService = null
function getAppStoreService(config) {
  if (!appstoreService)
    appstoreService = createAppStoreService(config)
  return appstoreService
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

  const service = getAppStoreService(config)

  // 1. 本地验签通知（验签失败 = 伪造或配置错误，拒绝）
  let notification
  try {
    notification = await service.verifyNotification(body.signedPayload)
  }
  catch (err) {
    console.warn('[appstore-notify] 通知验签失败:', err.message)
    return httpResponse(401, { message: '验签失败' })
  }

  try {
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

    // 2. 本地验签交易内容（环境取通知 payload 中声明的环境）
    const environment = notification.data?.environment || 'Production'
    const payload = await service.verifyTransactionInfo(signedTx, environment)

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
