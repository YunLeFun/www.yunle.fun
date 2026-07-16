/**
 * 云函数 sso-ticket —— 签发一次性自定义登录票据（CloudBase createTicket）。
 *
 * 两条路径：
 *  1) 既有「调用者上下文」路径（SDK callFunction，无 action）：只凭调用者自身登录态、签发其
 *     自己 uid 的票据，不接受外部传入 uid。跨站 SSO 桥接页（/auth/sso）走这条，行为不变。
 *  2) 新增「内部服务」路径（HTTP，action='mintForUser'）：Nuxt 服务端验过自己的 httpOnly cookie、
 *     拿到可信 uid 后，凭 serviceToken（= SSO_TICKET_INTERNAL_TOKEN）请求为该 uid 铸票，用于双层
 *     会话的 cookie→内存登录（见 docs/cookie-session-migration.md）。私钥始终只在本函数 env。
 *  3) 测试身份 Broker 路径（action='mintForTestLease'）：只接受独立服务令牌与已预留的 lease / issuance
 *     标识，自行读取受保护状态、原子认领、签发不超过租约截止时间的 ticket，并以 AES-GCM 托管。
 *
 * 客户端用 `signInWithCustomTicket(() => ticket)` 换取自己独立、可同源续期的会话。
 *
 * 配置（CloudBase 控制台 → 登录授权 → 自定义登录 → 下载私钥后注入函数 env）：
 *   - SSO_TICKET_PRIVATE_KEY_ID    私钥 ID（private_key_id）
 *   - SSO_TICKET_PRIVATE_KEY       私钥 PEM（private_key）；env 注入建议用 `\n` 转义或 base64
 *   - SSO_TICKET_REFRESH_SEC       可选，票据派生会话的可续期时长（秒），默认 30 天
 *   - SSO_TICKET_INTERNAL_TOKEN    内部服务 token（mintForUser 路径校验），需与 Nuxt 端
 *                                  NUXT_SSO_TICKET_INTERNAL_TOKEN 一致；未配置则该路径一律拒绝
 *   - TEST_BROKER_INTERNAL_TOKEN   测试身份 Broker 专用 token（不得与其它内部 token 共用）
 *   - TEST_TICKET_ESCROW_KEY       32 字节标准 base64 AES-GCM key，与 Broker 解密配置一致
 * 未配置私钥时返回 { ok:false, reason:'not_configured' }，桥接页据此回退（向后兼容）。
 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const { isAnonUid, isValidTicketUid, normalizePrivateKey, tokensMatch } = require('./mint')
const { mintForTestLease: mintTestLeaseTicket } = require('./test-lease')
const { createTestLeaseStore } = require('./test-lease-store')

const ENV = cloudbase.SYMBOL_CURRENT_ENV
const DEFAULT_REFRESH_SEC = 60 * 60 * 24 * 30 // 30 天可续期

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// 读调用者身份用的 app（绑定函数调用上下文）。
const contextApp = cloudbase.init({ env: ENV })
const db = contextApp.database()

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

// 共享铸票逻辑：uid 已确认可信。
function mintTicket(uid) {
  const signAuth = getSignAuth()
  if (!signAuth)
    return { ok: false, reason: 'not_configured' }
  try {
    // refresh/expire 单位是毫秒：refresh=访问令牌刷新间隔，expire=会话可续期的绝对截止时间。
    const ticket = signAuth.createTicket(uid, {
      refresh: 60 * 60 * 1000,
      expire: Date.now() + refreshSec() * 1000,
    })
    return { ok: true, ticket }
  }
  catch (err) {
    console.error('[sso-ticket] createTicket failed:', err && err.message)
    return { ok: false, reason: 'error' }
  }
}

// 路径 1：调用者上下文 —— 只签发调用者自己的 uid。
function mintForCaller() {
  let uid = ''
  try {
    uid = contextApp.auth().getUserInfo()?.uid || ''
  }
  catch {
    uid = ''
  }
  if (isAnonUid(uid))
    return { ok: false, reason: 'not_authenticated' }
  return mintTicket(uid)
}

// 路径 2：内部服务 —— Nuxt 验过 cookie，凭 serviceToken + 显式 uid 铸票。
function mintForUser(payload) {
  if (!tokensMatch(payload && payload.serviceToken, process.env.SSO_TICKET_INTERNAL_TOKEN))
    return { ok: false, reason: 'forbidden' }
  if (!isValidTicketUid(payload && payload.uid))
    return { ok: false, reason: 'invalid_uid' }
  return mintTicket(payload.uid)
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

function httpJson(statusCode, obj) {
  return { statusCode, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
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

exports.main = async function main(event) {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      return httpJson(400, { ok: false, reason: 'bad_json' })
    }
  }

  let result
  if (payload && payload.action === 'mintForTestLease')
    result = await mintForTestLease(payload)
  else if (payload && payload.action === 'mintForUser')
    result = mintForUser(payload)
  else
    result = mintForCaller()

  const status = payload?.action === 'mintForTestLease'
    ? testLeaseHttpStatus(result)
    : result.ok ? 200 : 401
  return isHttp ? httpJson(status, result) : result
}

exports._private = { mintForUser, mintForTestLease, mintForCaller, mintTicket, testLeaseHttpStatus }
