/**
 * 云函数 sso-ticket —— 一次性 SSO 授权码 + CloudBase custom ticket 同源兑换。
 *
 * 三条受限步骤：
 *  1) `issueSsoCode` 仅接受已认证 SDK 调用，从 CloudBase 调用上下文派生当前 uid，签发绑定
 *     origin/returnUrl/nonce 的 256-bit 一次性授权码；绝不接受调用者选择 uid。
 *  2) `exchangeSsoCode` 仅接受 HTTPS 网关 POST，原子消费授权码；普通账号从 CloudBase 服务端
 *     用户资料确认手机号，固定测试账号从受保护目录确认可用状态，再返回 ticket 与断言。
 *  3) 测试身份 Broker 路径（action='mintForTestLease'）：只接受独立服务令牌与已预留的 lease / issuance
 *     标识，自行读取受保护状态、原子认领、签发不超过租约截止时间的 ticket，并以 AES-GCM 托管。
 *
 * 客户端用 `signInWithCustomTicket(() => ticket)` 换取自己独立、可同源续期的会话。
 *
 * 配置（CloudBase 控制台 → 登录授权 → 自定义登录 → 下载私钥后注入函数 env）：
 *   - SSO_TICKET_PRIVATE_KEY_ID    私钥 ID（private_key_id）
 *   - SSO_TICKET_PRIVATE_KEY       私钥 PEM（private_key）；env 注入建议用 `\n` 转义或 base64
 *   - SSO_TICKET_REFRESH_SEC       可选，票据派生会话的可续期时长（秒），默认 30 天
 *   - AUTH_ISSUER_ENVIRONMENT      production | development；由部署决定
 *   - SSO_IDENTITY_SIGNING_KEY     身份断言 Ed25519 私钥（PEM/JWK 或 base64）
 *   - SSO_IDENTITY_SIGNING_KID     当前身份断言密钥 ID
 *   - SSO_IDENTITY_PUBLIC_KEYS     可选，轮换期保留的 kid -> public JWK
 *   - TEST_BROKER_INTERNAL_TOKEN   测试身份 Broker 专用 token（不得与其它内部 token 共用）
 *   - TEST_TICKET_ESCROW_KEY       32 字节标准 base64 AES-GCM key，与 Broker 解密配置一致
 * 未配置私钥时返回 { ok:false, reason:'not_configured' }。
 */

'use strict'

const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { assertActiveAccountForUid } = require('./account-access')
const { resolveFixedTestIdentityAdmission } = require('./fixed-test-identity-admission')
const { IdentityAdmissionError, resolvePhoneVerificationAdmission } = require('./identity-admission')
const { createIdentityAssertionRuntime } = require('./identity-assertion')
const { isAnonUid, isValidTicketUid, normalizePrivateKey } = require('./mint')
const { createSsoClientRegistry } = require('./sso-client-registry')
const { createSsoCodeStore, SsoCodeStoreError } = require('./sso-code-store')
const { createSsoRateLimiter, SsoRateLimitError } = require('./sso-rate-limit')
const {
  SsoRequestError,
  assertNoCallerSelectedSubject,
  isAllowedRequestOrigin,
  validateExchangeRequest,
  validateIssueRequest,
} = require('./sso-request')
const { mintForTestLease: mintTestLeaseTicket } = require('./test-lease')
const { createTestLeaseStore } = require('./test-lease-store')

const ENV = cloudbase.SYMBOL_CURRENT_ENV
const DEFAULT_REFRESH_SEC = 60 * 60 * 24 * 30 // 30 天可续期

// 读调用者身份用的 app（绑定函数调用上下文）。
const contextApp = cloudbase.init({ env: ENV })
const db = contextApp.database()
const ssoCodeStore = createSsoCodeStore(db)
const ssoRateLimiter = createSsoRateLimiter(db)
const callAccountApi = data => contextApp.callFunction({ name: 'account-api', data }).then(r => r.result)

function assertActiveAccount(uid) {
  return assertActiveAccountForUid(callAccountApi, {
    serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    userId: uid,
  })
}

// 签发票据用的 app（需自定义登录私钥）。惰性构建并缓存；未配置时缓存 null 以便优雅降级。
let cachedSignAuth
function getSignAuth() {
  if (cachedSignAuth !== undefined)
    return cachedSignAuth
  const privateKeyId = process.env.SSO_TICKET_PRIVATE_KEY_ID
  const privateKey = normalizePrivateKey(process.env.SSO_TICKET_PRIVATE_KEY)
  if (!privateKeyId || !privateKey) {
    cachedSignAuth = null
    return cachedSignAuth
  }
  // createTicket 要求 credentials 带 env_id，且必须等于运行时 env。用 SDK 自己的上下文取真实
  // env 字符串（SYMBOL_CURRENT_ENV 仅 init 可用，credentials.env_id 必须是字符串）。
  const ctx = cloudbase.getCloudbaseContext()
  const envId = ctx.TCB_ENV || ctx.SCF_NAMESPACE
  cachedSignAuth = cloudbase
    .init({ env: envId, credentials: { env_id: envId, private_key_id: privateKeyId, private_key: privateKey } })
    .auth()
  return cachedSignAuth
}

function refreshSec() {
  const n = Number(process.env.SSO_TICKET_REFRESH_SEC)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFRESH_SEC
}

// 共享铸票逻辑：uid 已确认可信；测试租约可额外收紧绝对失效时间。
function mintTicket(uid, expiresAtLimit) {
  const signAuth = getSignAuth()
  if (!signAuth)
    return { ok: false, reason: 'not_configured' }
  try {
    const now = Date.now()
    const configuredExpiresAt = now + refreshSec() * 1000
    const expiresAt = Number.isSafeInteger(expiresAtLimit)
      ? Math.min(configuredExpiresAt, expiresAtLimit)
      : configuredExpiresAt
    const remaining = expiresAt - now
    if (remaining <= 0)
      return { ok: false, reason: 'test_lease_inactive' }
    // refresh/expire 单位是毫秒：refresh=访问令牌刷新间隔，expire=会话可续期的绝对截止时间。
    const ticket = signAuth.createTicket(uid, {
      refresh: Math.min(60 * 60 * 1000, remaining),
      expire: expiresAt,
    })
    return { ok: true, ticket }
  }
  catch (err) {
    console.error('[sso-ticket] createTicket failed:', err && err.message)
    return { ok: false, reason: 'error' }
  }
}

function currentCallerUid() {
  let uid = ''
  try {
    uid = contextApp.auth().getUserInfo()?.uid || ''
  }
  catch {
    uid = ''
  }
  if (isAnonUid(uid))
    throw new SsoRequestError('not_authenticated', 'authenticated current user is required')
  return uid
}

let cachedClientRegistry
let cachedClientRegistryKey = ''
function getSsoClientRegistry() {
  const issuerEnvironment = process.env.AUTH_ISSUER_ENVIRONMENT === 'development' ? 'development' : 'production'
  if (!cachedClientRegistry || cachedClientRegistryKey !== issuerEnvironment) {
    cachedClientRegistry = createSsoClientRegistry({ issuerEnvironment })
    cachedClientRegistryKey = issuerEnvironment
  }
  return cachedClientRegistry
}

let cachedIdentityRuntime
let cachedIdentityRuntimeKey = ''
function getIdentityAssertionRuntime() {
  const registry = getSsoClientRegistry()
  const cacheKey = [
    registry.issuer,
    process.env.SSO_IDENTITY_SIGNING_KEY || '',
    process.env.SSO_IDENTITY_SIGNING_KID || '',
    process.env.SSO_IDENTITY_PUBLIC_KEYS || '',
    process.env.SSO_IDENTITY_ASSERTION_TTL_SEC || '',
  ].join('\0')
  if (cachedIdentityRuntimeKey !== cacheKey) {
    cachedIdentityRuntime = createIdentityAssertionRuntime({
      issuer: registry.issuer,
      signingKey: process.env.SSO_IDENTITY_SIGNING_KEY,
      signingKid: process.env.SSO_IDENTITY_SIGNING_KID,
      publicKeys: process.env.SSO_IDENTITY_PUBLIC_KEYS,
      ttlSeconds: process.env.SSO_IDENTITY_ASSERTION_TTL_SEC,
    })
    cachedIdentityRuntimeKey = cacheKey
  }
  return cachedIdentityRuntime
}

function ssoRequestOptions() {
  return { clientRegistry: getSsoClientRegistry() }
}

function positiveEnvInt(name, fallback, maximum) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}

function securityLimits() {
  return {
    issuePerUser: positiveEnvInt('SSO_ISSUE_PER_USER_PER_MINUTE', 10, 1_000),
    issuePerIp: positiveEnvInt('SSO_ISSUE_PER_IP_PER_MINUTE', 30, 5_000),
    exchangePerIp: positiveEnvInt('SSO_EXCHANGE_PER_IP_PER_MINUTE', 60, 5_000),
    exchangePerOrigin: positiveEnvInt('SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE', 300, 10_000),
  }
}

function auditId(value) {
  return createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 16)
}

function auditSecurity(event, details) {
  console.warn('[sso-ticket] security_event', JSON.stringify({ event, ...details }))
}

// 路径 1：已认证调用者上下文签发一次性授权码，uid 只从运行时上下文取得。
async function issueSsoCode(payload, clientAddress = 'unknown') {
  const uid = currentCallerUid()
  if (!isValidTicketUid(uid))
    return { ok: false, reason: 'not_authenticated' }
  await assertActiveAccount(uid)
  const request = validateIssueRequest(payload, { ...ssoRequestOptions(), actorUid: uid })
  const limits = securityLimits()
  await Promise.all([
    ssoRateLimiter.consume({ scope: 'issue-user', key: `${uid}\0${request.clientId}\0${request.targetOrigin}`, limit: limits.issuePerUser, windowMs: 60_000 }),
    ssoRateLimiter.consume({ scope: 'issue-ip', key: clientAddress, limit: limits.issuePerIp, windowMs: 60_000 }),
  ])
  const issued = await ssoCodeStore.issue({ uid, ...request })
  auditSecurity('sso_code_issued', {
    subject: auditId(uid),
    clientId: request.clientId,
    appId: request.appId,
    issuer: request.issuer,
    scopes: request.scopes,
    origin: request.targetOrigin,
    policyVersion: request.policyVersion,
    registrationFingerprint: request.registrationFingerprint,
  })
  return { ok: true, code: issued.code, expiresAt: issued.expiresAt }
}

// 路径 2：HTTP Origin 与 nonce 都必须命中授权码绑定；消费成功后才铸 CloudBase ticket。
async function exchangeSsoCode(payload, requestOrigin, clientAddress = 'unknown') {
  const request = validateExchangeRequest(payload, requestOrigin, ssoRequestOptions())
  const identityRuntime = getIdentityAssertionRuntime()
  if (!identityRuntime)
    return { ok: false, reason: 'not_configured' }
  const limits = securityLimits()
  await Promise.all([
    ssoRateLimiter.consume({ scope: 'exchange-ip', key: clientAddress, limit: limits.exchangePerIp, windowMs: 60_000 }),
    ssoRateLimiter.consume({ scope: 'exchange-origin', key: requestOrigin, limit: limits.exchangePerOrigin, windowMs: 60_000 }),
  ])
  const { uid } = await ssoCodeStore.consume(request)
  await assertActiveAccount(uid)
  const phoneAdmission = await resolvePhoneVerificationAdmission({
    auth: contextApp.auth(),
    uid,
    resolveFixedTestIdentity: input => resolveFixedTestIdentityAdmission(db, {
      ...input,
      issuerEnvironment: process.env.AUTH_ISSUER_ENVIRONMENT === 'development'
        ? 'development'
        : 'production',
    }),
  })
  auditSecurity('sso_code_consumed', {
    subject: auditId(uid),
    clientId: request.clientId,
    appId: request.appId,
    issuer: request.issuer,
    scopes: request.scopes,
    origin: requestOrigin,
    policyVersion: request.policyVersion,
    registrationFingerprint: request.registrationFingerprint,
  })
  const ticketResult = mintTicket(uid)
  if (!ticketResult.ok)
    return ticketResult
  return {
    ...ticketResult,
    identityAssertion: identityRuntime.sign({
      subject: uid,
      clientId: request.clientId,
      appId: request.appId,
      scopes: request.scopes,
      nonce: request.nonce,
      phoneNumberVerified: phoneAdmission.phoneNumberVerified,
    }),
  }
}

// 路径 3：受管测试身份。Broker 不能传 uid 或任意过期时间；签发函数从受保护集合解析。
async function mintForTestLease(payload) {
  const signAuth = getSignAuth()
  if (!signAuth)
    return { ok: false, reason: 'not_configured', definitive: true }
  const store = createTestLeaseStore(db)
  return mintTestLeaseTicket(payload, {
    expectedToken: process.env.TEST_BROKER_INTERNAL_TOKEN || '',
    escrowKey: process.env.TEST_TICKET_ESCROW_KEY || '',
    now: () => Date.now(),
    ...store,
    createTicket: (uid, options) => signAuth.createTicket(uid, options),
  })
}

function corsHeaders(origin) {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      }
    : {}
}

function httpJson(statusCode, obj, origin = '') {
  return {
    statusCode,
    headers: {
      ...corsHeaders(origin),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
    },
    body: JSON.stringify(obj),
  }
}

function httpJwks(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Cache-Control': statusCode === 200
        ? 'public, max-age=300, stale-while-revalidate=300'
        : 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(obj),
  }
}

function testLeaseHttpStatus(result) {
  if (result.ok)
    return 200
  if (result.reason === 'forbidden')
    return 403
  if (result.reason === 'invalid_request')
    return 400
  if (result.reason === 'ticket_mint_in_progress')
    return 409
  if (result.reason === 'not_configured' || result.definitive === false)
    return 503
  return 422
}

function header(event, name) {
  const headers = event?.headers || {}
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found ? String(found[1] || '') : ''
}

function clientAddress(event, isHttp) {
  if (!isHttp) {
    try {
      return contextApp.auth().getClientIP() || 'unknown'
    }
    catch {
      return 'unknown'
    }
  }
  return String(
    event?.requestContext?.http?.sourceIp
    || event?.requestContext?.identity?.sourceIp
    || 'unknown',
  ).trim().slice(0, 128)
}

function parseHttpPayload(event) {
  const forwardedProto = header(event, 'x-forwarded-proto').toLowerCase()
  if (forwardedProto && forwardedProto !== 'https')
    throw new SsoRequestError('https_required', 'HTTPS is required')
  const contentType = header(event, 'content-type').toLowerCase()
  if (event.body && !contentType.startsWith('application/json'))
    throw new SsoRequestError('invalid_content_type', 'application/json is required')
  const raw = event.isBase64Encoded
    ? Buffer.from(String(event.body || ''), 'base64').toString('utf8')
    : String(event.body || '')
  if (Buffer.byteLength(raw, 'utf8') > 4096)
    throw new SsoRequestError('payload_too_large', 'request body is too large')
  try {
    return raw ? JSON.parse(raw) : {}
  }
  catch {
    throw new SsoRequestError('bad_json', 'request body is not valid JSON')
  }
}

exports.main = async function main(event) {
  const isHttp = !!(event && event.httpMethod)
  const requestOrigin = isHttp
    ? String(event.headers?.origin || event.headers?.Origin || '')
    : ''
  if (isHttp && event.httpMethod === 'OPTIONS') {
    const options = ssoRequestOptions()
    const allowed = isAllowedRequestOrigin(requestOrigin, options)
    return allowed
      ? { statusCode: 204, headers: corsHeaders(requestOrigin), body: '' }
      : httpJson(403, { ok: false, reason: 'origin_not_allowed' })
  }
  if (isHttp && event.httpMethod === 'GET') {
    try {
      const identityRuntime = getIdentityAssertionRuntime()
      return identityRuntime
        ? httpJwks(200, identityRuntime.publicJwks())
        : httpJwks(503, { keys: [] })
    }
    catch (error) {
      console.error('[sso-ticket] JWKS unavailable:', error && error.message)
      return httpJwks(503, { keys: [] })
    }
  }
  if (isHttp && event.httpMethod !== 'POST')
    return httpJson(405, { ok: false, reason: 'method_not_allowed' })

  let payload = event || {}
  if (isHttp) {
    try {
      payload = parseHttpPayload(event)
    }
    catch (error) {
      const reason = error instanceof SsoRequestError ? error.reason : 'bad_json'
      const status = reason === 'payload_too_large' ? 413 : reason === 'invalid_content_type' ? 415 : reason === 'https_required' ? 403 : 400
      return httpJson(status, { ok: false, reason })
    }
  }

  let result
  try {
    assertNoCallerSelectedSubject(payload)
    if (payload && payload.action === 'mintForTestLease')
      result = await mintForTestLease(payload)
    else if (isHttp && payload && payload.action === 'exchangeSsoCode')
      result = await exchangeSsoCode(payload, requestOrigin, clientAddress(event, true))
    else if (!isHttp && payload && payload.action === 'issueSsoCode')
      result = await issueSsoCode(payload, clientAddress(event, false))
    else
      result = { ok: false, reason: 'invalid_request' }
  }
  catch (error) {
    if (error instanceof SsoRequestError || error instanceof SsoCodeStoreError || error instanceof SsoRateLimitError) {
      result = { ok: false, reason: error.reason }
      auditSecurity('sso_request_rejected', { reason: error.reason, origin: requestOrigin || undefined })
    }
    else if (typeof error?.code === 'string' && error.code.startsWith('account_')) {
      result = { ok: false, reason: error.code }
      auditSecurity('sso_request_rejected', { reason: error.code, origin: requestOrigin || undefined })
    }
    else if (error instanceof IdentityAdmissionError) {
      result = { ok: false, reason: error.reason }
      auditSecurity('sso_request_rejected', { reason: error.reason, origin: requestOrigin || undefined })
    }
    else {
      console.error('[sso-ticket] request failed:', error && error.message)
      result = { ok: false, reason: 'error' }
    }
  }

  const status = payload?.action === 'mintForTestLease'
    ? testLeaseHttpStatus(result)
    : result.ok
      ? 200
      : ['invalid_request', 'invalid_scope', 'client_required', 'subject_not_allowed', 'pkce_required'].includes(result.reason)
          ? 400
          : ['client_unknown', 'client_unavailable', 'adapter_not_allowed', 'origin_not_allowed', 'return_url_not_allowed', 'client_binding_invalid', 'code_binding_invalid', 'pkce_invalid', 'forbidden', 'phone_verification_required', 'account_banned', 'account_deletion_pending', 'account_deletion_finalizing', 'account_access_unavailable'].includes(result.reason)
              ? 403
              : result.reason === 'rate_limited'
                ? 429
                : ['code_used'].includes(result.reason)
                    ? 409
                    : ['not_configured', 'registry_invalid', 'registry_unavailable', 'identity_unavailable', 'error'].includes(result.reason)
                        ? 503
                        : 401
  const responseOrigin = payload?.action === 'exchangeSsoCode'
    && isAllowedRequestOrigin(requestOrigin, ssoRequestOptions())
    ? requestOrigin
    : ''
  return isHttp ? httpJson(status, result, responseOrigin) : result
}

exports._private = {
  exchangeSsoCode,
  issueSsoCode,
  mintForTestLease,
  mintTicket,
  testLeaseHttpStatus,
}
