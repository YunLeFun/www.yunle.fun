/**
 * 云函数 ai-gateway —— 通用「登录计费 + 受控 AI 生成」网关。
 *
 * 设计目标（高内聚低耦合）：
 *   - 本函数只做通用三件事：① 取登录态 uid ② 按 appId 查服务端权威「模型/计价」
 *     ③ 余额校验 + 管理员身份调 AI + 按次扣费。**收发通用 messages/content，不含任何
 *     业务语义**（不知道"春联"为何物）——业务侧 prompt 构造与结果解析全留在各应用自己手里。
 *   - 计价 / 模型 / AI 凭证锁在服务端（APP_REGISTRY），端用户改不了 cost/model。
 *   - 账户能力（查余额 / 扣云币）凭 ACCOUNT_API_INTERNAL_TOKEN 转调既有 account-api，
 *     account-api 零改动（与 desktop-auth 同一内部代理模式）。
 *
 * 防白嫖（与 CloudBase 网关权限策略配合）：
 *   AI 由本函数以**管理员身份**（app.ai() 走函数内置服务凭证）调用；端用户的
 *   access_token 在网关侧对 `ai` 资源被 deny，无法直打 /v1/ai/<group>，只能经此函数计费生成。
 *
 * 入口：ai-sfc 服务端经 /v1/functions/ai-gateway 携带用户 access_token 调用，
 *       event = { action:'chat', appId, messages, bizId }，返回纯对象（HTTP 网关包 { result }）。
 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { deductCoinForUid, getAccountForUid } = require('./lib/account-proxy')
const { runMeteredChat } = require('./lib/relay')
const { assertBizId, assertMessages, isAnonUid } = require('./lib/validation')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })

/** account-api 转调器（同 env 函数间调用，取 result） */
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

/**
 * 应用计价 / 模型注册表 —— **服务端权威**，端用户无法篡改 cost/model/group。
 * 新接入一个应用 = 在此加一条 + 重新部署。注意：这里只有"计费与模型"配置，
 * 没有任何业务域知识（如何构造 prompt、如何解析结果都在应用侧）。
 */
const APP_REGISTRY = {
  'ai-sfc': { group: 'custom-deepseek-open', model: 'deepseek-v4-flash', cost: 1 },
}

/** 当前调用者 uid（CloudBase Auth）；匿名 / 占位身份一律视为未登录返回 '' */
function getCallerUid() {
  try {
    const uid = app.auth().getUserInfo()?.uid || ''
    return isAnonUid(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

/**
 * 用管理员身份调 CloudBase AI（端用户 token 在网关被 deny，故此路径服务端独占）。
 * @returns {Promise<string>} 模型输出纯文本
 */
async function generateWithAdmin(appCfg, messages) {
  const model = app.ai().createModel(appCfg.group)
  const res = await model.generateText({ model: appCfg.model, messages })
  if (res && res.error)
    throw new Error(typeof res.error === 'string' ? res.error : '模型返回错误')
  return (res && res.text) || ''
}

/** 处理一次计费生成请求 */
async function handleChat(event) {
  const serviceToken = process.env.ACCOUNT_API_INTERNAL_TOKEN || ''
  const appId = typeof event.appId === 'string' ? event.appId : ''
  const appCfg = APP_REGISTRY[appId]
  if (!appCfg)
    return { ok: false, code: 'unknown_app', message: '未知应用。' }

  let messages
  let bizId
  try {
    messages = assertMessages(event.messages)
    bizId = assertBizId(event.bizId)
  }
  catch (err) {
    return { ok: false, code: err.code || 'bad_request', message: err.message }
  }

  const uid = getCallerUid()

  return runMeteredChat({ uid, cost: appCfg.cost, messages, bizId }, {
    getBalance: async (u) => {
      const acc = await getAccountForUid(callAccountApi, { serviceToken, userId: u })
      return typeof acc?.coin === 'number' ? acc.coin : 0
    },
    generate: msgs => generateWithAdmin(appCfg, msgs),
    deduct: ({ amount, bizId: id }) => deductCoinForUid(callAccountApi, {
      serviceToken,
      userId: uid,
      appId,
      amount,
      bizId: id,
      meta: { kind: 'aiChat' },
    }),
  })
}

/** 路由分发（payload 同 SDK event 形态 { action, ... }）。纯逻辑，HTTP 包装见 main。 */
async function dispatch(event) {
  switch (event && event.action) {
    case 'chat':
      return await handleChat(event)
    default:
      throw new Error(`未知 action: ${event && event.action}`)
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/**
 * 入口兼容两种调用：
 *   - SDK callFunction / HTTP /v1/functions（带登录态）：event = { action, ... }，返回纯对象。
 *   - HTTP 访问服务：event = { httpMethod, headers, body(JSON 字符串) }，返回 { statusCode, headers, body }。
 */
exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, code: 'bad_request', message: '请求体不是合法 JSON' }) }
    }
  }

  try {
    const result = await dispatch(payload)
    return isHttp
      ? { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) }
      : result
  }
  catch (err) {
    console.error('[ai-gateway] 处理失败:', payload && payload.action, err.message)
    if (isHttp)
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, code: 'error', message: err.message }) }
    throw err
  }
}

exports._private = { dispatch, handleChat, generateWithAdmin, APP_REGISTRY }
