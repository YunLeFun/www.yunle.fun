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
const { APP_REGISTRY, messageLimitsForApp } = require('./lib/app-registry')
const { verifyAppRequest, verifyRateLimitRequest } = require('./lib/attestation')
const {
  auditAction,
  auditMessageCount,
  auditOutcome,
  auditRequestId,
  buildAuditRecord,
  emitAuditLog,
} = require('./lib/audit-log')
const { reserveIpRateLimit, runIpRateLimit } = require('./lib/ip-rate-limit')
const { releaseDailyQuota, reserveDailyQuota, runQuotaChat } = require('./lib/quota')
const { runMeteredChat } = require('./lib/relay')
const { assertBizId, assertMessages, isAnonUid } = require('./lib/validation')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const writeAuditLog = message => process.stdout.write(`${message}\n`)

/** account-api 转调器（同 env 函数间调用，取 result） */
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

async function handleRateLimit(event) {
  const appId = typeof event.appId === 'string' ? event.appId : ''
  const appCfg = APP_REGISTRY[appId]
  const clientKey = typeof event.clientKey === 'string' ? event.clientKey : ''
  if (!appCfg?.ipRateLimit || !/^[a-f0-9]{64}$/.test(clientKey))
    return { ok: false, code: 'forbidden', message: '应用来源校验失败。' }

  const signingSecret = process.env[appCfg.signingSecretEnv] || ''
  const attestationValid = verifyRateLimitRequest(signingSecret, {
    appId,
    clientKey,
    signature: event.attestation?.signature,
    timestamp: event.attestation?.timestamp,
  })
  if (!attestationValid)
    return { ok: false, code: 'forbidden', message: '应用来源校验失败。' }

  return runIpRateLimit({ appId, clientKey }, {
    reserve: input => reserveIpRateLimit(db, {
      ...input,
      ...appCfg.ipRateLimit,
    }),
  })
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
    messages = assertMessages(event.messages, messageLimitsForApp(appCfg))
    bizId = assertBizId(event.bizId)
  }
  catch (err) {
    return { ok: false, code: err.code || 'bad_request', message: err.message }
  }

  const uid = getCallerUid()

  if (appCfg.billing === 'daily_quota') {
    const signingSecret = process.env[appCfg.signingSecretEnv] || ''
    const attestationValid = verifyAppRequest(signingSecret, {
      appId,
      bizId,
      messages,
      signature: event.attestation?.signature,
      timestamp: event.attestation?.timestamp,
    })
    if (!attestationValid)
      return { ok: false, code: 'forbidden', message: '应用来源校验失败。' }

    if (!uid)
      return { ok: false, code: 'unauthorized', message: '请先登录后再使用。' }

    const account = await getAccountForUid(callAccountApi, { serviceToken, userId: uid })
    const memberActive = account?.membership?.isActive === true
    const limit = memberActive ? appCfg.memberDailyLimit : appCfg.standardDailyLimit
    return runQuotaChat({ uid, limit, messages }, {
      reserve: () => reserveDailyQuota(db, { uid, appId, limit }),
      generate: msgs => generateWithAdmin(appCfg, msgs),
      release: reservation => releaseDailyQuota(db, reservation),
    })
  }

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
    case 'rateLimit':
      return await handleRateLimit(event)
    default:
      throw new Error('未知 action')
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
exports.main = async (event, context = {}) => {
  const startedAt = Date.now()
  const requestId = auditRequestId(context)
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      const result = { ok: false, code: 'bad_request', message: '请求体不是合法 JSON' }
      emitAuditLog(writeAuditLog, buildAuditRecord({
        action: 'unknown',
        durationMs: Date.now() - startedAt,
        messageCount: 0,
        outcome: auditOutcome(result),
        requestId,
      }))
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(result) }
    }
  }

  const action = auditAction(payload)
  const messageCount = auditMessageCount(payload)
  try {
    const result = await dispatch(payload)
    emitAuditLog(writeAuditLog, buildAuditRecord({
      action,
      durationMs: Date.now() - startedAt,
      messageCount,
      outcome: auditOutcome(result),
      requestId,
    }))
    return isHttp
      ? { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) }
      : result
  }
  catch {
    const result = { ok: false, code: 'error', message: '服务暂时不可用。' }
    emitAuditLog(writeAuditLog, buildAuditRecord({
      action,
      durationMs: Date.now() - startedAt,
      messageCount,
      outcome: 'error',
      requestId,
    }))
    return isHttp
      ? { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(result) }
      : result
  }
}

exports._private = { dispatch, handleChat, handleRateLimit, generateWithAdmin, APP_REGISTRY }
