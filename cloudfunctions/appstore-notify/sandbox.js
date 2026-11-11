/** Package as appstore-notify-sandbox/index.js; no Production ledger access. */
'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { createAppStoreService } = require('./lib/appstore')
const { handleIapRefund } = require('./lib/iap')
const { createSandboxIapDatabase, parseSandboxUsers } = require('./lib/iap-sandbox')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const rawDb = app.database()
function response(statusCode, body) {
  return { isBase64Encoded: false, statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

exports.main = async (event) => {
  if (event?.httpMethod !== 'POST')
    return response(405, { message: 'Method Not Allowed' })
  let body
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
    body = typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  catch {
    return response(400, { message: '请求格式错误' })
  }
  if (typeof body?.signedPayload !== 'string' || !body.signedPayload)
    return response(400, { message: 'signedPayload 缺失' })
  let db
  let service
  try {
    db = createSandboxIapDatabase(rawDb, parseSandboxUsers(process.env.IAP_SANDBOX_TEST_UIDS))
    service = createAppStoreService({
      issuerId: process.env.APPSTORE_ISSUER_ID,
      keyId: process.env.APPSTORE_KEY_ID,
      privateKeyPem: process.env.APPSTORE_PRIVATE_KEY,
      bundleId: process.env.APPSTORE_BUNDLE_ID,
    })
  }
  catch {
    return response(500, { message: 'Sandbox 服务未配置' })
  }
  let notification
  try {
    notification = await service.verifyNotification(body.signedPayload)
  }
  catch {
    return response(401, { message: '验签失败' })
  }
  const environment = notification.data?.environment || notification.summary?.environment
  if (environment !== 'Sandbox')
    return response(400, { message: '仅接受 Sandbox 通知' })
  if (!['REFUND', 'REVOKE'].includes(notification.notificationType))
    return response(200, { ok: true })
  try {
    const signedTx = notification.data?.signedTransactionInfo
    if (typeof signedTx !== 'string' || !signedTx)
      return response(400, { message: '退款交易缺失' })
    const payload = await service.verifyTransactionInfo(signedTx, environment)
    if (payload.environment !== environment || payload.bundleId !== process.env.APPSTORE_BUNDLE_ID
      || typeof payload.transactionId !== 'string' || !/^\d{1,32}$/.test(payload.transactionId)
      || !Number.isFinite(payload.revocationDate) || payload.revocationDate <= 0) {
      return response(400, { message: '退款交易不匹配' })
    }
    await handleIapRefund(db, { payload, now: Date.now() })
    return response(200, { ok: true })
  }
  catch {
    return response(500, { message: 'Sandbox 退款处理失败' })
  }
}
