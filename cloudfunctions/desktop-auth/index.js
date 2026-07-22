/**
 * 云函数 desktop-auth —— 桌面 / 本地应用登录与授权（设备授权码 + Ed25519 离线 entitlement）。
 *
 * 设计文档：docs/desktop-sso.md；接入手册：docs/desktop-sso-integration.md。
 *
 * 双入口：
 *   - SDK callFunction（授权页携带登录态）：event = { action, ... }，返回纯对象。
 *   - HTTP 访问服务（设备侧，凭 deviceCode/refreshToken/entitlement 鉴权）：
 *     event = { httpMethod, headers, body(JSON 字符串) }，返回 { statusCode, headers, body }。
 *
 * 主入口只做「解析 + 鉴权分流 + 路由」，业务逻辑在 lib/，便于单测。
 * 账户能力（查余额 / 扣云币）验签后转调既有 account-api，account-api 零改动。
 *
 * 注：兑换码（redeemCode / claimDeviceRedemption）按设计文档 Phase 3 后续实现。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { assertActiveAccountForUid, deductCoinForUid, getAccountForUid } = require('./lib/account-proxy')
const { randomToken } = require('./lib/crypto')
const {
  approveDevice,
  denyDevice,
  describeDevice,
  pollDeviceToken,
  startDeviceAuth,
} = require('./lib/device-codes')
const { listDevices, refreshEntitlement, registerDevice, revokeDevice } = require('./lib/devices')
const { signEntitlement, verifyEntitlement, publicKeyToJwk, toPrivateKey } = require('./lib/entitlement')
const {
  DEFAULT_ENTITLEMENT_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  DEFAULT_VERIFICATION_URL,
  assertAmount,
  assertBizId,
  isAnonUid,
} = require('./lib/validation')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

/** account-api 转调器（同 env 函数间调用，取 result） */
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

/**
 * 归一化签发私钥的 env 形态：支持 JWK JSON（`{...}`）/ PEM（`-----`）/ 以及二者的 base64。
 * 用 base64 是因为 JWK JSON 含引号、PEM 含换行，直接经 cloudbaserc 的 `{{env}}` 注入 JSON
 * 会破坏格式；base64 无引号/换行/空格，对 env 文件、JSON 注入、shell 都安全。
 *
 * @param {string} raw
 * @returns {string} JWK JSON 或 PEM 文本
 */
function decodeSigningKey(raw) {
  const s = String(raw).trim()
  if (s.startsWith('{') || s.startsWith('-----'))
    return s
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8').trim()
    if (decoded.startsWith('{') || decoded.includes('-----'))
      return decoded
  }
  catch {}
  return s
}

// ── 运行时配置（首次使用时加载并缓存）──────────────────────
let _runtime
function loadRuntime() {
  if (_runtime)
    return _runtime
  const signingRaw = process.env.DESKTOP_AUTH_SIGNING_KEY
  if (!signingRaw)
    throw new Error('desktop-auth 未配置 DESKTOP_AUTH_SIGNING_KEY')
  const signingKeyText = decodeSigningKey(signingRaw)
  const privateKey = toPrivateKey(signingKeyText)

  // kid：优先 env，其次 JWK 内嵌 kid，最后兜底
  let kid = process.env.DESKTOP_AUTH_SIGNING_KID || ''
  if (!kid && signingKeyText.startsWith('{')) {
    try {
      kid = JSON.parse(signingKeyText).kid || ''
    }
    catch {}
  }
  kid = kid || 'desktop-default'

  // 验签公钥集：当前签发公钥（由私钥派生）+ 可选的退役公钥（JSON map：kid→jwk）
  const publicKeys = {}
  publicKeys[kid] = crypto.createPublicKey(privateKey).export({ format: 'jwk' })
  if (process.env.DESKTOP_AUTH_PUBLIC_KEYS) {
    try {
      const extra = JSON.parse(process.env.DESKTOP_AUTH_PUBLIC_KEYS)
      for (const [k, v] of Object.entries(extra)) publicKeys[k] = v
    }
    catch (err) {
      console.error('[desktop-auth] DESKTOP_AUTH_PUBLIC_KEYS 解析失败:', err.message)
    }
  }

  _runtime = {
    privateKey,
    kid,
    publicKeys,
    internalToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    verificationUri: process.env.DESKTOP_AUTH_VERIFICATION_URL || DEFAULT_VERIFICATION_URL,
    entitlementTtlSec: Number(process.env.DESKTOP_AUTH_ENTITLEMENT_TTL_SEC) || DEFAULT_ENTITLEMENT_TTL_SEC,
    refreshTtlSec: Number(process.env.DESKTOP_AUTH_REFRESH_TTL_SEC) || DEFAULT_REFRESH_TTL_SEC,
  }
  return _runtime
}

/** 当前调用者 uid（CloudBase Auth）；匿名 / 占位 / HTTP 无登录 → '' */
function getCallerUid() {
  try {
    const uid = app.auth().getUserInfo()?.uid || ''
    return isAnonUid(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

/** 拉最新账户快照并签发 entitlement（poll-approve 与 refresh 共用） */
async function buildEntitlement({ uid, appId, deviceId, scope, now }) {
  const rt = loadRuntime()
  await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
  const account = await getAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
  const entitlement = signEntitlement({
    privateKey: rt.privateKey,
    kid: rt.kid,
    uid,
    appId,
    deviceId,
    scope,
    membership: account.membership,
    now,
    ttlSec: rt.entitlementTtlSec,
    jti: randomToken(16),
  })
  return { entitlement, account }
}

// ── action 处理 ────────────────────────────────────────────
async function handlePoll(event, now) {
  const rt = loadRuntime()
  return pollDeviceToken(db, { deviceCode: event.deviceCode, deviceId: event.deviceId }, {
    now,
    onApproved: async (doc) => {
      const { refreshToken } = await registerDevice(db, {
        uid: doc.uid,
        appId: doc.appId,
        deviceId: doc.deviceId,
        deviceName: doc.deviceName,
        scope: doc.scope,
      }, { now, refreshTtlSec: rt.refreshTtlSec })
      const { entitlement, account } = await buildEntitlement({ uid: doc.uid, appId: doc.appId, deviceId: doc.deviceId, scope: doc.scope, now })
      return { entitlement, deviceRefreshToken: refreshToken, account }
    },
  })
}

async function handleGetAccount(event, now) {
  const rt = loadRuntime()
  const payload = verifyEntitlement(event.entitlement, { publicKeys: rt.publicKeys, now })
  if (isAnonUid(payload.sub))
    throw new Error('该 entitlement 无账号，请登录后再用')
  await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: payload.sub })
  return getAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: payload.sub })
}

async function handleDeductCoin(event, now) {
  const rt = loadRuntime()
  const payload = verifyEntitlement(event.entitlement, { publicKeys: rt.publicKeys, now })
  if (isAnonUid(payload.sub))
    throw new Error('该 entitlement 无账号，请登录后再用')
  if (!Array.isArray(payload.scope) || !payload.scope.includes('coin'))
    throw new Error('entitlement 无 coin 权限')
  await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: payload.sub })
  const amount = assertAmount(event.amount)
  const bizId = assertBizId(event.bizId)
  return deductCoinForUid(callAccountApi, {
    serviceToken: rt.internalToken,
    userId: payload.sub,
    appId: payload.aud,
    amount,
    bizId,
    meta: event.meta && typeof event.meta === 'object' ? event.meta : undefined,
  })
}

function handleGetPublicKeys() {
  const rt = loadRuntime()
  return { keys: Object.entries(rt.publicKeys).map(([kid, jwk]) => publicKeyToJwk(jwk, kid)) }
}

async function dispatch(event, now) {
  const rt = loadRuntime()
  switch (event.action) {
    // ── 设备侧（HTTP，凭证即鉴权）──
    case 'startDeviceAuth':
      return startDeviceAuth(db, event, { now, verificationUri: rt.verificationUri })
    case 'pollDeviceToken':
      return handlePoll(event, now)
    case 'refreshEntitlement':
      return refreshEntitlement(db, { deviceRefreshToken: event.deviceRefreshToken, deviceId: event.deviceId }, { now, refreshTtlSec: rt.refreshTtlSec, buildEntitlement })
    case 'getAccount':
      return handleGetAccount(event, now)
    case 'deductCoin':
      return handleDeductCoin(event, now)
    case 'getPublicKeys':
      return handleGetPublicKeys()

    // ── 授权页 / 个人中心（SDK callFunction，需登录态）──
    case 'describeDevice': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
      return describeDevice(db, event, { now })
    }
    case 'approveDevice': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
      return approveDevice(db, { userCode: event.userCode, uid }, { now })
    }
    case 'denyDevice': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
      return denyDevice(db, event, { now })
    }
    case 'listDevices': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
      return { devices: await listDevices(db, { uid }) }
    }
    case 'revokeDevice': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      await assertActiveAccountForUid(callAccountApi, { serviceToken: rt.internalToken, userId: uid })
      return revokeDevice(db, { uid, appId: event.appId, deviceId: event.deviceId }, { now })
    }
    default:
      throw new Error(`未知 action: ${event.action}`)
  }
}

// ── HTTP 信封 ──────────────────────────────────────────────
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*', // 凭证在 body 里（非 cookie），允许任意 origin（含桌面 webview）
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
function httpResponse(statusCode, obj) {
  return { isBase64Encoded: false, statusCode, headers: CORS_HEADERS, body: JSON.stringify(obj) }
}
function statusForError(err) {
  const code = err && err.code
  if (typeof code === 'string' && code.startsWith('account_'))
    return 403
  if (code === 'revoked' || code === 'expired')
    return 401
  const msg = (err && err.message) || ''
  if (/请先登录|鉴权|未授权|登录/.test(msg))
    return 401
  if (/余额不足/.test(msg))
    return 402
  return 400
}

exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return httpResponse(204, {})

  // HTTP 入口：body 是 JSON 字符串；SDK 入口：event 本身即 { action, ... }
  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      return httpResponse(400, { error: '请求体不是合法 JSON' })
    }
  }

  const now = Date.now()
  let result
  try {
    result = await dispatch(payload, now)
  }
  catch (err) {
    console.error('[desktop-auth] 处理失败:', payload.action, err.message)
    if (isHttp)
      return httpResponse(statusForError(err), { error: err.message, code: err.code })
    throw err
  }
  return isHttp ? httpResponse(200, result) : result
}

exports._private = { dispatch, buildEntitlement, statusForError }
