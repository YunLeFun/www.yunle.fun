/**
 * sso-ticket 纯函数：uid 校验、内部 token 比对、私钥规整。
 * 抽出来便于单测（见 tests/sso-ticket/mint.test.js），不依赖 CloudBase 运行时。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

// CloudBase createTicket 的 validateUid 约束：4–32 长度、受限字符集。
// 与 SDK 内部正则一致，提前拦截非法 uid，返回干净错误而非让 SDK 抛异常。
const TICKET_UID_RE = /^[\w#@~=*(){}[\]:.,<>+-]{4,32}$/

function isAnonUid(uid) {
  return !uid || uid === 'anon' || /^anonymous/i.test(uid)
}

function isValidTicketUid(uid) {
  return typeof uid === 'string' && TICKET_UID_RE.test(uid) && !isAnonUid(uid)
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

// 内部服务 token 定长比对（mirror account-api/internal.js）：长度不同或空一律判负。
function tokensMatch(provided, expected) {
  const a = Buffer.from(typeof provided === 'string' ? provided : '', 'utf8')
  const b = Buffer.from(typeof expected === 'string' ? expected : '', 'utf8')
  if (a.length === 0 || a.length !== b.length)
    return false
  return crypto.timingSafeEqual(a, b)
}

module.exports = { TICKET_UID_RE, isAnonUid, isValidTicketUid, normalizePrivateKey, tokensMatch }
