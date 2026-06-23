/**
 * GitHub App 鉴权与 GitHub REST 调用（Node 内置 crypto + 全局 fetch，零额外依赖）。
 *
 * 关键密钥（GITHUB_APP_PRIVATE_KEY / CLIENT_SECRET）只从 process.env 读取，
 * 永不出现在代码 / 仓库 / 客户端里。详见 docs/github-app-integration.md。
 *
 * 设计取向同 desktop-auth/lib/entitlement：纯函数（buildAppJwt / signState / verifyState）
 * 与 env 绑定的封装（appJwt / getInstallationToken / exchangeUserToken）分离，便于单测。
 */
'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'YunLeFun-github-api'
/** App JWT 有效期（秒）。GitHub 要求 ≤ 600s，这里留余量取 480s。 */
const JWT_TTL_SEC = 480
/** install state 有效期（毫秒）。 */
const STATE_TTL_MS = 10 * 60 * 1000

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBuffer(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

/**
 * 归一 private key 的 env 形态：支持直接 PEM（`-----`）或 PEM 的 base64。
 * 用 base64 是因为 PEM 含换行，经 env 文件 / JSON 注入易被破坏（同 desktop-auth 取向）。
 */
function decodeKey(raw) {
  const s = String(raw || '').trim()
  if (s.startsWith('-----'))
    return s
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8').trim()
    if (decoded.includes('-----'))
      return decoded
  }
  catch {}
  return s
}

/** 纯函数：用 App private key 以 RS256 签发 GitHub App JWT。 */
function buildAppJwt({ appId, privateKey, now = Date.now() }) {
  const nowSec = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + JWT_TTL_SEC, iss: String(appId) }))
  const signature = base64url(crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey))
  return `${header}.${payload}.${signature}`
}

/**
 * 纯函数：HMAC 签名 install state（内嵌 uid + 发起方 origin + 时间戳，防伪造 / 防重放）。
 * origin 让回调页知道该把 postMessage 发回哪个站（本地 dev / prod 都可），且因签名而可信。
 */
function signState({ uid, origin = '', secret, now = Date.now() }) {
  const payload = base64url(JSON.stringify({ uid, origin, ts: now }))
  const sig = base64url(crypto.createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

/** 纯函数：校验 install state，返回 { uid, origin }；失败 / 过期抛错。 */
function verifyState({ state, secret, now = Date.now(), ttlMs = STATE_TTL_MS }) {
  const [payload, sig] = String(state || '').split('.')
  if (!payload || !sig)
    throw new Error('state 缺失或格式错误')
  const expect = base64url(crypto.createHmac('sha256', secret).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Error('state 签名校验失败')
  let obj
  try {
    obj = JSON.parse(base64urlToBuffer(payload).toString('utf8'))
  }
  catch {
    throw new Error('state 内容解析失败')
  }
  if (!obj.uid || typeof obj.ts !== 'number' || now - obj.ts > ttlMs)
    throw new Error('state 已过期，请重新发起连接')
  return { uid: obj.uid, origin: obj.origin || '' }
}

// ── env 绑定（首次使用时加载并缓存）────────────────────────────
let _rt
function loadRuntime() {
  if (_rt)
    return _rt
  const appId = process.env.GITHUB_APP_ID
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKeyRaw)
    throw new Error('github-api 未配置 GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY')
  _rt = {
    appId: String(appId),
    privateKey: decodeKey(privateKeyRaw),
    clientId: process.env.GITHUB_APP_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || '',
    // slug 非密（出现在公开安装 URL），写死兜底为规范小写值；env 有值则优先
    slug: process.env.GITHUB_APP_SLUG || 'yunlefun',
    // 没单独配 state 密钥时复用内部服务令牌；至少要有一个
    stateSecret: process.env.GITHUB_APP_STATE_SECRET || process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    siteOrigin: process.env.GITHUB_APP_SITE_ORIGIN || 'https://www.yunle.fun',
  }
  if (!_rt.stateSecret)
    throw new Error('github-api 未配置 GITHUB_APP_STATE_SECRET')
  return _rt
}

function appJwt(now = Date.now()) {
  const { appId, privateKey } = loadRuntime()
  return buildAppJwt({ appId, privateKey, now })
}

/** 统一 GitHub REST 调用；token 为空则匿名（公开数据）。 */
async function githubFetch(path, { token, tokenType = 'Bearer', method = 'GET', body } = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `${tokenType} ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// installation token 缓存（warm 实例间复用，到期前 5min 失效）
const _tokenCache = new Map()
async function getInstallationToken(installationId) {
  const key = String(installationId)
  const cached = _tokenCache.get(key)
  if (cached && cached.expMs - Date.now() > 5 * 60 * 1000)
    return cached.token
  const res = await githubFetch(`/app/installations/${installationId}/access_tokens`, { token: appJwt(), method: 'POST' })
  if (!res.ok)
    throw new Error(`换取 installation token 失败：HTTP ${res.status}`)
  const data = await res.json()
  _tokenCache.set(key, { token: data.token, expMs: new Date(data.expires_at).getTime() })
  return data.token
}

/** 用 OAuth code 换 user-to-server token（仅安装回调时用于校验安装归属）。 */
async function exchangeUserToken(code) {
  const { clientId, clientSecret } = loadRuntime()
  if (!clientId || !clientSecret)
    throw new Error('github-api 未配置 CLIENT_ID / CLIENT_SECRET')
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token)
    throw new Error('OAuth code 交换失败')
  return data.access_token
}

module.exports = {
  GITHUB_API,
  USER_AGENT,
  STATE_TTL_MS,
  // 纯函数（可单测）
  base64url,
  decodeKey,
  buildAppJwt,
  signState,
  verifyState,
  // env 绑定
  loadRuntime,
  appJwt,
  githubFetch,
  getInstallationToken,
  exchangeUserToken,
}
