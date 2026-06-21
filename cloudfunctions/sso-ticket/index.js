/**
 * 云函数 sso-ticket —— 为「已登录的调用者」签发一次性自定义登录票据（CloudBase createTicket）。
 *
 * 用途：跨站 SSO 的 Web 桥接页（www.yunle.fun `/auth/sso`）在确认主站已登录后调用本函数，
 * 把返回的 ticket 经 postMessage 下发给子站；子站用 `signInWithCustomTicket(ticket)` 换取
 * **自己独立、可同源续期的会话**（独立 refresh_token、免疫第三方存储分区），不再复用主站会话。
 *
 * 鉴权：只凭调用者自身的登录态、签发其自己 uid 的票据（不接受外部传入 uid）；匿名/未登录拒发。
 *
 * 配置（CloudBase 控制台 → 登录授权 → 自定义登录 → 下载私钥后注入函数 env）：
 *   - SSO_TICKET_PRIVATE_KEY_ID   私钥 ID（private_key_id）
 *   - SSO_TICKET_PRIVATE_KEY      私钥 PEM（private_key）；env 注入建议用 `\n` 转义或 base64
 *   - SSO_TICKET_REFRESH_SEC      可选，票据派生会话的可续期时长（秒），默认 30 天
 * 未配置私钥时返回 { ok:false, reason:'not_configured' }，桥接页据此回退到转发 session（向后兼容）。
 */

'use strict'

const { Buffer } = require('node:buffer')
const cloudbase = require('@cloudbase/node-sdk')

const ENV = cloudbase.SYMBOL_CURRENT_ENV
const DEFAULT_REFRESH_SEC = 60 * 60 * 24 * 30 // 30 天可续期

// 读调用者身份用的 app（绑定函数调用上下文）。
const contextApp = cloudbase.init({ env: ENV })

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

// PEM 含换行，经 JSON/shell 注入易被破坏：兼容「\n 转义」与「base64」两种安全注入形态。
function normalizePrivateKey(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s)
    return ''
  if (s.includes('-----BEGIN'))
    return s.replace(/\\n/g, '\n')
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8')
    if (decoded.includes('-----BEGIN'))
      return decoded
  }
  catch {}
  return s.replace(/\\n/g, '\n')
}

function isAnonUid(uid) {
  return !uid || /^anonymous/i.test(uid)
}

function refreshSec() {
  const n = Number(process.env.SSO_TICKET_REFRESH_SEC)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFRESH_SEC
}

exports.main = async function main() {
  let uid = ''
  try {
    uid = contextApp.auth().getUserInfo()?.uid || ''
  }
  catch {
    uid = ''
  }
  if (isAnonUid(uid))
    return { ok: false, reason: 'not_authenticated' }

  const signAuth = getSignAuth()
  if (!signAuth)
    return { ok: false, reason: 'not_configured' }

  try {
    // createTicket 的 refresh/expire 单位是**毫秒**：refresh=访问令牌刷新间隔，
    // expire=会话可续期的绝对截止时间。给子站一份长期可续期的独立会话。
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
