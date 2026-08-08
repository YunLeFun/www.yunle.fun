/**
 * 云函数 iap-order —— iOS App Store 内购的服务端校验与权益发放。
 *
 * 路由 action：
 *   - verifyPurchase  校验单笔交易并发放权益（需登录；幂等）
 *   - restore         批量补单（恢复购买 / 杀进程后的 unfinished 交易，需登录）
 *
 * 安全模型：客户端只上送 transactionId，服务端经 App Store Server API 取得
 * 签名交易后用 Apple 官方库本地验签（证书链锚定 Apple 根证书）才入账
 *（见 lib/appstore.js 注释）。客户端应在本函数返回成功后再 finishTransaction。
 *
 * 环境变量：
 *   - APPSTORE_ISSUER_ID    App Store Connect「App 内购买」Issuer ID
 *   - APPSTORE_KEY_ID       App 内购买专用 Key ID
 *   - APPSTORE_PRIVATE_KEY  .p8 私钥内容（PEM，含 BEGIN/END 行）
 *   - APPSTORE_BUNDLE_ID    默认 fun.yunle.apps
 *   - APPSTORE_APP_APPLE_ID App Store 的 app Apple ID（可选，生产通知验签需要）
 *
 * lib/ 由 `pnpm sync:wxpay-lib` 从 cloudfunctions/wxpay-order/lib 同步，禁止直接修改本目录的 lib。
 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { assertActiveAccountForUid } = require('./account-access')

const { assertGrantablePayload, createAppStoreService } = require('./lib/appstore')
const { grantIapTransaction } = require('./lib/iap')
const { classifySyntheticOrderAccount } = require('./lib/synthetic-order')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

/** 单次 restore 最多处理的交易数 */
const RESTORE_MAX_TRANSACTIONS = 10

/** 匿名 / 占位身份（同 account-api），绝不能发放权益 */
const ANON_UIDS = new Set(['', 'anon'])

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
    throw new Error(`iap-order 配置缺失: ${missing.join(', ')}`)
  return cfg
}

/** App Store 服务（云函数实例存活期间复用，缓存 API 客户端与验签器） */
let appstoreService = null
function getAppStoreService(config) {
  if (!appstoreService)
    appstoreService = createAppStoreService(config)
  return appstoreService
}

/**
 * 校验并发放单笔交易（verifyPurchase / restore 共用）
 *
 * @param {string} uid
 * @param {string} transactionId
 * @param {object} config
 */
async function verifyAndGrant(uid, transactionId, config) {
  const service = getAppStoreService(config)
  const { payload, environment } = await service.getVerifiedTransaction(transactionId)
  assertGrantablePayload(payload, { bundleId: config.bundleId })
  return grantIapTransaction(db, {
    userId: uid,
    payload,
    environment,
    now: Date.now(),
  })
}

async function handleVerifyPurchase(uid, event, config) {
  const transactionId = String(event.transactionId || '')
  if (!/^\d+$/.test(transactionId))
    throw new Error('transactionId 非法')
  return verifyAndGrant(uid, transactionId, config)
}

async function handleRestore(uid, event, config) {
  const ids = Array.isArray(event.transactionIds) ? event.transactionIds : []
  const unique = [...new Set(ids.map(String).filter(id => /^\d+$/.test(id)))]
    .slice(0, RESTORE_MAX_TRANSACTIONS)
  const results = []
  for (const transactionId of unique) {
    try {
      const result = await verifyAndGrant(uid, transactionId, config)
      results.push({ transactionId, ok: true, granted: result.granted })
    }
    catch (err) {
      console.warn(`[iap-order] restore 失败 ${transactionId}:`, err.message)
      results.push({ transactionId, ok: false, error: err.message })
    }
  }
  return { results }
}

exports.main = async (event) => {
  const { action } = event || {}
  try {
    const uid = getCallerUid()
    if (!uid)
      throw new Error('请先登录')
    await assertActiveAccountForUid(callAccountApi, {
      serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
      userId: uid,
    })
    const classification = await classifySyntheticOrderAccount(db, uid)
    if (classification.synthetic)
      throw new Error('测试账号不允许校验或发放 App Store 真实内购')
    const config = loadConfig()

    switch (action) {
      case 'verifyPurchase':
        return await handleVerifyPurchase(uid, event, config)
      case 'restore':
        return await handleRestore(uid, event, config)
      default:
        throw new Error(`未知 action: ${action}`)
    }
  }
  catch (err) {
    console.error('[iap-order] 处理失败:', err.message)
    throw err
  }
}
