/**
 * ai-gateway 入参校验（与具体业务/春联无关，纯通用聊天网关）。
 *
 * 业务错误统一抛出带 `code` 的 Error，由 index.js 转成 { ok:false, code, message }，
 * 便于 ai-sfc 侧把 code 映射到 HTTP 状态（bad_request→400 等）。
 */

'use strict'

/**
 * 匿名 / 占位身份集合。CloudBase 在「仅用公开 accessKey、未真正登录」时
 * 会以匿名身份调用云函数，getUserInfo().uid 可能为空或 'anon'。
 * 这类身份绝不能用于扣费 / 读余额，否则会命中共享占位账户。
 */
const ANON_UIDS = new Set(['', 'anon'])

/** @param {string} uid @returns {boolean} 是否匿名 / 未登录 */
function isAnonUid(uid) {
  return ANON_UIDS.has(uid)
}

/** 带 code 的业务错误（便于上层映射 HTTP 状态） */
function codedError(code, message) {
  return Object.assign(new Error(message), { code })
}

/**
 * 校验幂等键 bizId（非空字符串，长度上限防滥用）。
 *
 * @param {unknown} bizId
 * @returns {string} 归一化后的 bizId
 */
function assertBizId(bizId) {
  if (typeof bizId !== 'string' || !bizId.trim())
    throw codedError('bad_request', 'bizId 必填')
  const id = bizId.trim()
  if (id.length > 128)
    throw codedError('bad_request', 'bizId 过长')
  return id
}

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant'])

/**
 * 校验并归一化通用聊天 messages（OpenAI 风格）。资源护栏（条数 / 字数上限）是
 * 通用防滥用，不含任何业务语义——网关不关心 messages 的内容是不是春联（解耦）。
 *
 * @param {unknown} messages
 * @param {{ maxMessages?: number, maxChars?: number }} [limits]
 * @returns {Array<{ role: string, content: string }>} 归一化消息
 */
function assertMessages(messages, { maxMessages = 32, maxChars = 8000 } = {}) {
  if (!Array.isArray(messages) || messages.length === 0)
    throw codedError('bad_request', 'messages 必须为非空数组')
  if (messages.length > maxMessages)
    throw codedError('bad_request', `messages 不得超过 ${maxMessages} 条`)

  let totalChars = 0
  const normalized = messages.map((m) => {
    if (!m || typeof m !== 'object' || !ALLOWED_ROLES.has(m.role) || typeof m.content !== 'string')
      throw codedError('bad_request', 'messages 格式非法（需 {role, content}）')
    totalChars += m.content.length
    return { role: m.role, content: m.content }
  })
  if (totalChars > maxChars)
    throw codedError('bad_request', 'messages 内容过长')

  return normalized
}

module.exports = { isAnonUid, codedError, assertBizId, assertMessages }
