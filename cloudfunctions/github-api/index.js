/**
 * 云函数 github-api —— 多用户 GitHub App 仓库连接 / 列举 / 校验（含私有仓库）。
 *
 * 设计文档：docs/github-app-integration.md。
 *
 * 双入口：
 *   - SDK callFunction（带登录态）：event = { action, ... }，返回纯对象。所有 action 需登录。
 *   - HTTP 访问服务：GitHub 安装回调 GET /github-api/callback（?code&installation_id&state），返回 HTML。
 *
 * 密钥（App private key / client secret）只从 process.env 读取（见 lib/app-auth）。
 * 仓库读取统一用短期 installation token（warm 缓存），不持久化任何用户 token。
 */
'use strict'

const cloudbase = require('@cloudbase/node-sdk')

const {
  exchangeUserToken,
  getInstallationToken,
  githubFetch,
  loadRuntime,
  signState,
  verifyState,
} = require('./lib/app-auth')
const { deleteInstallation, getInstallation, upsertInstallation } = require('./lib/store')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const ANON_UIDS = new Set(['', 'anon'])
function getCallerUid() {
  try {
    const uid = app.auth().getUserInfo()?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

const RE_REPO = /^[\w.-]+\/[\w.-]+$/

function mapRepo(r) {
  return {
    fullName: r.full_name,
    private: !!r.private,
    language: r.language || null,
    stargazers: r.stargazers_count || 0,
    description: r.description || null,
    updatedAt: r.updated_at || null,
  }
}

// ── SDK actions（均需登录）────────────────────────────────────
async function getConnection(uid) {
  const inst = await getInstallation(db, uid)
  return inst
    ? { connected: true, githubLogin: inst.githubLogin, accountType: inst.accountType, repositorySelection: inst.repositorySelection }
    : { connected: false }
}

function getInstallUrl(uid, event = {}) {
  const { slug, stateSecret } = loadRuntime()
  if (!slug)
    throw new Error('github-api 未配置 GITHUB_APP_SLUG')
  // 把发起方 origin 签进 state，回调据此把 postMessage 发回原站（本地 dev / prod 皆可）
  const state = signState({ uid, origin: event.origin || '', secret: stateSecret })
  return { url: `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}` }
}

// 换取 installation token；遇 404（App 已卸载 / installation 失效）→ 删陈旧映射并提示重连（懒自愈）
async function tokenOrHeal(uid, inst) {
  try {
    return await getInstallationToken(inst.installationId)
  }
  catch (err) {
    if (err && err.status === 404) {
      await deleteInstallation(db, uid)
      throw new Error('GitHub 连接已失效（App 可能已被卸载），请重新连接')
    }
    throw err
  }
}

async function listRepos(uid, { query, page } = {}) {
  const inst = await getInstallation(db, uid)
  if (!inst)
    throw new Error('尚未连接 GitHub')
  const token = await tokenOrHeal(uid, inst)
  const p = Math.max(Number(page) || 1, 1)
  const res = await githubFetch(`/installation/repositories?per_page=100&page=${p}`, { token, tokenType: 'token' })
  if (!res.ok)
    throw new Error(`列举仓库失败：HTTP ${res.status}`)
  const data = await res.json()
  const all = Array.isArray(data.repositories) ? data.repositories : []
  const q = String(query || '').trim().toLowerCase()
  const repos = (q ? all.filter(r => r.full_name.toLowerCase().includes(q)) : all).map(mapRepo)
  const total = Number(data.total_count) || all.length
  return { repos, hasMore: p * 100 < total }
}

async function checkRepo(uid, { repo } = {}) {
  const name = String(repo || '').trim()
  if (!RE_REPO.test(name))
    throw new Error('仓库格式应为 owner/repo')
  const inst = await getInstallation(db, uid)
  if (!inst)
    throw new Error('尚未连接 GitHub')
  const token = await tokenOrHeal(uid, inst)
  const res = await githubFetch(`/repos/${name}`, { token, tokenType: 'token' })
  if (res.status === 404)
    return { exists: false }
  if (!res.ok)
    throw new Error(`校验仓库失败：HTTP ${res.status}`)
  return { exists: true, meta: mapRepo(await res.json()) }
}

function disconnect(uid) {
  return deleteInstallation(db, uid)
}

async function dispatch(event) {
  const uid = getCallerUid()
  if (!uid)
    throw new Error('请先登录')
  switch (event.action) {
    case 'getConnection':
      return getConnection(uid)
    case 'getInstallUrl':
      return getInstallUrl(uid, event)
    case 'listRepos':
      return listRepos(uid, event)
    case 'checkRepo':
      return checkRepo(uid, event)
    case 'disconnect':
      return disconnect(uid)
    default:
      throw new Error(`未知 action: ${event.action}`)
  }
}

// ── 安装回调（HTTP GET，GitHub 重定向至此）────────────────────
async function handleInstallCallback(query) {
  const { code, installation_id: installationId, state, setup_action: setupAction } = query
  // 用户向组织管理员申请安装（尚无 installation），提示等待批准
  if (setupAction === 'request')
    return { ok: false, message: '已提交安装申请，待组织管理员批准后再回来连接' }
  if (!installationId || !state)
    throw new Error('回调参数缺失')

  const { stateSecret } = loadRuntime()
  const { uid, origin } = verifyState({ state, secret: stateSecret })

  // 用 user token 校验该 installation 确属本次授权用户，
  // 防止有人用自己的 state + 他人的 installation_id 冒领他人安装。
  if (!code)
    throw new Error('回调缺少 code，无法校验安装归属（请在 App 设置开启安装时请求用户授权）')
  const userToken = await exchangeUserToken(code)
  const res = await githubFetch('/user/installations', { token: userToken })
  if (!res.ok)
    throw new Error(`读取用户安装失败：HTTP ${res.status}`)
  const data = await res.json()
  const match = (data.installations || []).find(i => String(i.id) === String(installationId))
  if (!match)
    throw new Error('安装归属校验失败')

  await upsertInstallation(db, uid, {
    installationId: Number(installationId),
    githubLogin: match.account?.login || '',
    accountType: match.account?.type || '',
    repositorySelection: match.repository_selection || '',
  }, Date.now())
  return { ok: true, origin }
}

// ── HTTP 信封 ─────────────────────────────────────────────────
function getQuery(event) {
  const q = event.queryStringParameters || event.queryString || event.query || {}
  if (typeof q !== 'string')
    return q
  const o = {}
  for (const [k, v] of new URLSearchParams(q))
    o[k] = v
  return o
}

function callbackHtml({ ok, message, origin }) {
  // 优先用 state 内签名过的 origin（本地 dev / prod 均可）；取不到再回退站点默认，避免错误页二次抛错
  let target = origin || ''
  if (!target) {
    try {
      target = loadRuntime().siteOrigin
    }
    catch {
      target = 'https://www.yunle.fun'
    }
  }
  const payload = JSON.stringify({ type: 'github_app_callback', success: !!ok, message: message || '' })
  const text = ok ? '连接成功，窗口即将关闭…' : (message || '连接未完成')
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>GitHub</title></head>`
    + `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#334">`
    + `<p>${text}</p><script>`
    + `try{if(window.opener){window.opener.postMessage(${JSON.stringify(payload)},${JSON.stringify(target)});}}catch(e){}`
    + `setTimeout(function(){if(window.opener){window.close();}else{location.replace(${JSON.stringify(`${target}/apps/new`)});}},600);`
    + `</script></body></html>`
}

function htmlResponse(statusCode, html) {
  return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  // HTTP GET = 安装回调；actions 一律走 SDK callFunction
  if (isHttp) {
    if (event.httpMethod !== 'GET')
      return htmlResponse(405, '<p>Method Not Allowed</p>')
    try {
      const result = await handleInstallCallback(getQuery(event))
      return htmlResponse(200, callbackHtml(result))
    }
    catch (err) {
      console.error('[github-api] 安装回调失败:', err.message)
      return htmlResponse(200, callbackHtml({ ok: false, message: err.message }))
    }
  }

  try {
    return await dispatch(event || {})
  }
  catch (err) {
    console.error('[github-api] 处理失败:', event && event.action, err.message)
    throw err
  }
}

exports._private = { dispatch, getConnection, listRepos, checkRepo, handleInstallCallback, mapRepo }
