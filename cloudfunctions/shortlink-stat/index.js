/**
 * 云函数 shortlink-stat —— 短链点击统计（公开写入 + 内部读取）。
 *
 * 写入（公开）：EdgeOne 跳转边缘函数在每次成功 302 后 fire-and-forget POST 上报点击,
 *   按 (domain, slug) 分片原子累加到 shortlink_stats（见 stat.js）。
 * 读取（内部）：admin 控制面经 SDK callFunction({ action: 'getClicks', host, slug }) 取累计点击。
 *
 * 双入口（同 shortlink-resolve / account-api 约定）：
 *   - HTTP 访问服务：event = { httpMethod, body(JSON 字符串) } → { statusCode, headers, body }
 *                    一律按「写入」处理（边缘函数只会走 HTTP）。
 *   - SDK callFunction：event = { action:'getClicks', host, slug } 读;否则 event 即上报 payload。
 *
 * 云内以 SYMBOL_CURRENT_ENV 初始化,运行于环境管理态,绕过安全规则直接读写。
 * 统计失败绝不让调用方重试风暴：HTTP 出错也回 200（边缘 fire-and-forget 本就忽略响应）。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

const { getClicks, recordClick } = require('./stat')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  // 读取入口（仅 SDK，内部调用）：取累计点击
  if (!isHttp && event && event.action === 'getClicks') {
    try {
      return { clicks: await getClicks(db, event) }
    }
    catch (err) {
      console.error('[shortlink-stat] 读取失败:', err && err.message)
      return { clicks: 0, error: 'read failed' }
    }
  }

  // 写入入口：HTTP（边缘上报）或 SDK 直传 payload
  let payload = event || {}
  if (isHttp) {
    if (!event.body) {
      payload = {}
    }
    else {
      try {
        payload = JSON.parse(event.body)
      }
      catch {
        return json(400, { error: '请求体不是合法 JSON' })
      }
    }
  }

  try {
    const res = await recordClick(db, payload)
    return isHttp ? json(200, res) : res
  }
  catch (err) {
    console.error('[shortlink-stat] 记录失败:', err && err.message)
    // 计数失败不抛错、不让边缘重试
    return isHttp ? json(200, { ok: false }) : { ok: false }
  }
}
