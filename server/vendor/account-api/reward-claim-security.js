/** Cryptographic boundaries for reward-claim links and pseudonymous IP rate tickets. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const RATE_TICKET_VERSION = 'rct1'
const RATE_TICKET_TTL_MS = 120_000
const MAX_CLOCK_SKEW_MS = 30_000

class RewardClaimSecurityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RewardClaimSecurityError'
    this.code = code
  }
}

function assertSecret(value, name) {
  const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0
  if (length < 32 || length > 512)
    throw new RewardClaimSecurityError('security_not_configured', `${name} 必须为 32-512 字节`)
  return value
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string')
    return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function publicLinkDigest(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 512)
    throw new RewardClaimSecurityError('invalid_link_token', '领取链接令牌无效')
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

function createRewardClaimTokenPort(options = {}) {
  const hashKey = assertSecret(options.hashKey, 'REWARD_CLAIM_LINK_HASH_KEY')
  const randomBytes = options.randomBytes || crypto.randomBytes
  const siteUrl = new URL(options.siteUrl || 'https://www.yunle.fun')

  return {
    generate() {
      const value = randomBytes(32)
      if (!Buffer.isBuffer(value) || value.length !== 32)
        throw new RewardClaimSecurityError('random_source_invalid', '安全随机源返回值无效')
      return value.toString('base64url')
    },
    digest(rawToken) {
      publicLinkDigest(rawToken)
      return crypto.createHmac('sha256', hashKey).update(rawToken).digest('hex')
    },
    publicUrl(rawToken) {
      publicLinkDigest(rawToken)
      const url = new URL('/claim', siteUrl)
      url.hash = rawToken
      return url.toString()
    },
  }
}

function normalizeIp(value) {
  const ip = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!ip || ip.length > 128)
    throw new RewardClaimSecurityError('ip_unavailable', '无法确认请求来源')
  return ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip
}

function sign(secret, content) {
  return crypto.createHmac('sha256', secret).update(content).digest('base64url')
}

function parsePayload(encoded) {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object')
      throw new Error('invalid payload')
    return parsed
  }
  catch {
    throw new RewardClaimSecurityError('rate_ticket_invalid', '速率凭证格式无效')
  }
}

function createRewardClaimRateTicket(options = {}) {
  const secret = assertSecret(options.secret, 'REWARD_CLAIM_RATE_TICKET_SECRET')
  if (options.linkHashKey && safeEqual(secret, options.linkHashKey))
    throw new RewardClaimSecurityError('security_key_reuse', '链接摘要与速率凭证密钥必须相互独立')
  const now = options.now || Date.now
  const randomBytes = options.randomBytes || crypto.randomBytes

  function issue({ linkDigest, ip }) {
    if (typeof linkDigest !== 'string' || !/^[a-f0-9]{64}$/.test(linkDigest))
      throw new RewardClaimSecurityError('link_digest_invalid', '链接摘要无效')
    const issuedAt = now()
    const nonce = randomBytes(16)
    if (!Buffer.isBuffer(nonce) || nonce.length !== 16)
      throw new RewardClaimSecurityError('random_source_invalid', '安全随机源返回值无效')
    const payload = {
      v: 1,
      ld: linkDigest,
      ih: crypto.createHmac('sha256', secret)
        .update(`reward-claim-ip:v1:${normalizeIp(ip)}`)
        .digest('hex'),
      iat: issuedAt,
      exp: issuedAt + RATE_TICKET_TTL_MS,
      nonce: nonce.toString('base64url'),
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const content = `${RATE_TICKET_VERSION}.${encoded}`
    return `${content}.${sign(secret, content)}`
  }

  function verify(ticket, { tokenDigest }) {
    const parts = typeof ticket === 'string' ? ticket.split('.') : []
    if (parts.length !== 3 || parts[0] !== RATE_TICKET_VERSION)
      throw new RewardClaimSecurityError('rate_ticket_invalid', '速率凭证格式无效')
    const content = `${parts[0]}.${parts[1]}`
    if (!safeEqual(parts[2], sign(secret, content)))
      throw new RewardClaimSecurityError('rate_ticket_invalid', '速率凭证签名无效')
    const payload = parsePayload(parts[1])
    if (payload.v !== 1
      || typeof payload.ld !== 'string'
      || typeof payload.ih !== 'string'
      || typeof payload.nonce !== 'string'
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.exp - payload.iat !== RATE_TICKET_TTL_MS) {
      throw new RewardClaimSecurityError('rate_ticket_invalid', '速率凭证字段无效')
    }
    const current = now()
    if (payload.iat > current + MAX_CLOCK_SKEW_MS)
      throw new RewardClaimSecurityError('rate_ticket_invalid', '速率凭证签发时间无效')
    if (payload.exp < current)
      throw new RewardClaimSecurityError('rate_ticket_expired', '速率凭证已过期')
    if (!safeEqual(payload.ld, tokenDigest))
      throw new RewardClaimSecurityError('rate_ticket_link_mismatch', '速率凭证与领取链接不匹配')
    return {
      ipHash: payload.ih,
      linkDigest: payload.ld,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      nonce: payload.nonce,
    }
  }

  return { issue, verify }
}

module.exports = {
  RATE_TICKET_TTL_MS,
  RewardClaimSecurityError,
  createRewardClaimRateTicket,
  createRewardClaimTokenPort,
  publicLinkDigest,
}
