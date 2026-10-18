/** Package as iap-order-sandbox/index.js; never replace the Production entry. */
'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { assertActiveAccountForUid } = require('./account-access')
const { assertGrantablePayload, createAppStoreService } = require('./lib/appstore')
const { grantIapTransaction } = require('./lib/iap')
const { assertSandboxUser, createSandboxIapDatabase, parseSandboxUsers } = require('./lib/iap-sandbox')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const rawDb = app.database()
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

function callerUid() {
  try {
    return app.auth().getUserInfo()?.uid || ''
  }
  catch {
    return ''
  }
}

function config() {
  const value = {
    issuerId: process.env.APPSTORE_ISSUER_ID,
    keyId: process.env.APPSTORE_KEY_ID,
    privateKeyPem: process.env.APPSTORE_PRIVATE_KEY,
    bundleId: process.env.APPSTORE_BUNDLE_ID,
  }
  if (Object.values(value).some(v => !v))
    throw new Error('Sandbox App Store 配置缺失')
  return value
}

exports.main = async (event) => {
  const db = createSandboxIapDatabase(rawDb, parseSandboxUsers(process.env.IAP_SANDBOX_TEST_UIDS))
  const uid = callerUid()
  assertSandboxUser(db, uid)
  await assertActiveAccountForUid(callAccountApi, {
    serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    userId: uid,
  })
  const settings = config()
  const service = createAppStoreService(settings)
  async function verify(transactionId) {
    if (typeof transactionId !== 'string' || !/^\d{1,32}$/.test(transactionId))
      throw new Error('transactionId 非法')
    const { payload, environment } = await service.getVerifiedTransaction(transactionId)
    if (payload.transactionId !== transactionId)
      throw new Error('Apple 返回交易与请求不一致')
    assertGrantablePayload(payload, { bundleId: settings.bundleId })
    return grantIapTransaction(db, { userId: uid, payload, environment, now: Date.now() })
  }
  if (event?.action === 'verifyPurchase')
    return verify(event.transactionId)
  if (event?.action === 'restore') {
    if (!Array.isArray(event.transactionIds) || event.transactionIds.length > 10
      || event.transactionIds.some(id => typeof id !== 'string' || !/^\d{1,32}$/.test(id))) {
      throw new Error('restore 交易列表非法')
    }
    const results = []
    for (const transactionId of new Set(event.transactionIds)) {
      try {
        const result = await verify(transactionId)
        results.push({ transactionId, ok: true, granted: result.granted })
      }
      catch {
        // Do not echo Apple, SDK or account-service diagnostic details.
        results.push({ transactionId, ok: false, error: 'Sandbox 交易校验失败' })
      }
    }
    return { results }
  }
  throw new Error('未知 Sandbox action')
}
