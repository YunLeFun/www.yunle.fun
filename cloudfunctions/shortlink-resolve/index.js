/**
 * 云函数 shortlink-resolve —— 短链只读解析（公开）。
 *
 * 供 EdgeOne 跳转边缘函数在 KV 缓存未命中时回源调用：按 (domain, slug) 读
 * CloudBase short_links（admin 控制面维护的源真相），返回跳转目标。
 *
 * 双入口（同 account-api 约定）：
 *   - HTTP 访问服务：event = { httpMethod, headers, queryStringParameters, body(JSON 字符串) }
 *                    → 返回 { statusCode, headers, body }
 *   - SDK callFunction：event = { host, slug } → 返回纯对象
 *
 * 仅读 short_links 单集合，无登录态、无密钥；云内以 SYMBOL_CURRENT_ENV 初始化，
 * 函数运行于环境管理态，绕过安全规则可直接读取。
 *
 * 启停 / 过期不在此判定：原样返回 enabled / expireAt，交由边缘函数决定，
 * 以便其对「停用 / 过期」也做负向缓存，减少回源。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

/** 与 admin 控制面一致（packages/cloudbase/index.ts: SHORT_LINKS_COLLECTION） */
const SHORT_LINKS_COLLECTION = 'short_links'

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** 按 (host, slug) 解析；命中返回原始字段，未命中返回 { found: false }。 */
async function resolve({ host, slug }) {
  const domain = String(host || '').trim().toLowerCase()
  const key = String(slug || '').trim().toLowerCase()
  if (!domain || !key)
    return { found: false }

  const { data } = await db
    .collection(SHORT_LINKS_COLLECTION)
    .where({ domain, slug: key })
    .limit(1)
    .get()

  const rec = Array.isArray(data) ? data[0] : undefined
  if (!rec)
    return { found: false }

  return {
    found: true,
    target: rec.target || '',
    enabled: rec.enabled !== false,
    expireAt: typeof rec.expireAt === 'number' ? rec.expireAt : 0,
  }
}

exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  // 入参：HTTP 支持 query(?host=&slug=) 或 JSON body；SDK 直接取 event
  let input = event || {}
  if (isHttp) {
    const q = event.queryStringParameters || {}
    let body = {}
    if (event.body) {
      try {
        body = JSON.parse(event.body)
      }
      catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: '请求体不是合法 JSON' }) }
      }
    }
    input = { host: q.host ?? body.host, slug: q.slug ?? body.slug }
  }

  try {
    const result = await resolve(input)
    return isHttp
      ? { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) }
      : result
  }
  catch (err) {
    console.error('[shortlink-resolve] 解析失败:', err && err.message)
    if (isHttp)
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'resolve failed' }) }
    throw err
  }
}
