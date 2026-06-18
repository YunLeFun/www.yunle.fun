/**
 * Entitlement —— 桌面端唯一的长期凭证，替代「主站 session」。
 *
 * 它是一个**标准 EdDSA(Ed25519) JWT**：服务端用私钥签发，客户端内置公钥即可
 * **离线验签**（任何标准 JWT 库都能验，不绑定本实现）。设计依据见 docs/desktop-sso.md §4。
 *
 * 安全要点：
 *   - 只支持单一算法 EdDSA：验签时**硬性要求 header.alg === 'EdDSA'**，
 *     拒绝 alg=none / HMAC 等，杜绝 alg-confusion（这是 JWT 最经典的漏洞面）。
 *   - kid 选择公钥：支持密钥轮换（新私钥签发、旧公钥保留到旧 token 全过期）。
 *   - 签发只用 node:crypto 的 Ed25519 原语（与本仓 lib/crypto.js 一致的零依赖风格），
 *     不手搓签名算法本身。
 *
 * 密钥以 KeyObject / PEM / JWK 任一形式传入（env 解析在 index.js，本模块不碰 process.env）。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const ALG = 'EdDSA'
const TYP = 'JWT'
const ISS = 'yunle.fun'

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}
function b64urlJson(obj) {
  return b64url(Buffer.from(JSON.stringify(obj), 'utf8'))
}
function decodeJsonSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
}

/** 把 KeyObject / PEM 字符串 / JWK 对象 归一化为私钥 KeyObject */
function toPrivateKey(key) {
  if (!key)
    throw new Error('缺少签发私钥')
  if (typeof key === 'object' && key.type === 'private')
    return key // 已是 KeyObject
  if (typeof key === 'object')
    return crypto.createPrivateKey({ key, format: 'jwk' })
  // 字符串：PEM 或 JWK-JSON
  const s = String(key).trim()
  if (s.startsWith('{'))
    return crypto.createPrivateKey({ key: JSON.parse(s), format: 'jwk' })
  return crypto.createPrivateKey(s)
}

/** 把 KeyObject / PEM 字符串 / JWK 对象 归一化为公钥 KeyObject */
function toPublicKey(key) {
  if (!key)
    throw new Error('缺少验签公钥')
  if (typeof key === 'object' && key.type === 'public')
    return key
  if (typeof key === 'object')
    return crypto.createPublicKey({ key, format: 'jwk' })
  const s = String(key).trim()
  if (s.startsWith('{'))
    return crypto.createPublicKey({ key: JSON.parse(s), format: 'jwk' })
  return crypto.createPublicKey(s)
}

/**
 * 签发 entitlement。
 *
 * @param {object} args
 * @param {object|string} args.privateKey Ed25519 私钥（KeyObject/PEM/JWK）
 * @param {string} args.kid 密钥 id（写进 JWT header，供验签方选公钥）
 * @param {string|null} args.uid 账号 uid；离线兑换的无账号 entitlement 传 null
 * @param {string} args.appId 受众（aud），限定本 entitlement 只对该应用有效
 * @param {string} args.deviceId 设备绑定（did）
 * @param {string[]} [args.scope]
 * @param {{ isActive?: boolean, level?: string|null, expireAt?: number|null }} [args.membership] 会员快照（仅供离线 UI 门控）
 * @param {number} args.now 当前时间戳(ms)
 * @param {number} args.ttlSec 有效期（秒），即离线宽限期
 * @param {string} args.jti 唯一 id（审计 / 黑名单）
 * @returns {string} 紧凑 JWT
 */
function signEntitlement({ privateKey, kid, uid, appId, deviceId, scope = ['membership', 'coin'], membership, now, ttlSec, jti }) {
  if (!kid)
    throw new Error('缺少 kid')
  if (!appId || !deviceId)
    throw new Error('缺少 appId / deviceId')
  const iat = Math.floor(now / 1000)
  const header = { alg: ALG, typ: TYP, kid }
  const payload = {
    iss: ISS,
    sub: uid ?? null,
    aud: appId,
    did: deviceId,
    scope,
    mbr: {
      active: !!(membership && membership.isActive),
      level: (membership && membership.level) || null,
      expireAt: (membership && membership.expireAt) || null,
    },
    iat,
    exp: iat + ttlSec,
    jti,
  }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = crypto.sign(null, Buffer.from(signingInput, 'utf8'), toPrivateKey(privateKey))
  return `${signingInput}.${b64url(sig)}`
}

/**
 * 解析 entitlement 的 header+payload，**不验签**。
 * 仅用于读 kid / 调试 / 客户端离线展示，绝不能据此做信任决策。
 *
 * @param {string} token
 * @returns {{ header: object, payload: object }} 解析出的头部与载荷（未经验签）
 */
function decodeEntitlement(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3)
    throw new Error('entitlement 格式非法')
  return { header: decodeJsonSegment(parts[0]), payload: decodeJsonSegment(parts[1]) }
}

/**
 * 验签并校验 entitlement。任何失败都抛错（调用方按未授权处理）。
 *
 * @param {string} token
 * @param {object} args
 * @param {Record<string, object|string>} args.publicKeys kid → 公钥（KeyObject/PEM/JWK）
 * @param {number} args.now 当前时间戳(ms)
 * @param {string} [args.expectedAud] 期望的 appId
 * @param {string} [args.expectedDeviceId] 期望的 deviceId
 * @param {number} [args.clockSkewSec] 允许的时钟偏移（秒），默认 60
 * @returns {object} 校验通过的 payload
 */
function verifyEntitlement(token, { publicKeys, now, expectedAud, expectedDeviceId, clockSkewSec = 60 }) {
  const parts = String(token).split('.')
  if (parts.length !== 3)
    throw new Error('entitlement 格式非法')
  const [h, p, s] = parts
  const header = decodeJsonSegment(h)

  // 算法钉死：只认 EdDSA，杜绝 alg-confusion（none / HS256 等一律拒绝）
  if (header.alg !== ALG || header.typ !== TYP)
    throw new Error('entitlement 算法不被接受')
  if (!header.kid || !publicKeys || !publicKeys[header.kid])
    throw new Error('entitlement kid 未知')

  const ok = crypto.verify(
    null,
    Buffer.from(`${h}.${p}`, 'utf8'),
    toPublicKey(publicKeys[header.kid]),
    Buffer.from(s, 'base64url'),
  )
  if (!ok)
    throw new Error('entitlement 签名无效')

  const payload = decodeJsonSegment(p)
  const nowSec = Math.floor(now / 1000)
  if (typeof payload.exp !== 'number' || payload.exp + clockSkewSec < nowSec)
    throw new Error('entitlement 已过期')
  if (expectedAud != null && payload.aud !== expectedAud)
    throw new Error('entitlement aud 不匹配')
  if (expectedDeviceId != null && payload.did !== expectedDeviceId)
    throw new Error('entitlement 设备不匹配')
  return payload
}

/**
 * 把公钥导出为 JWKS 的一项（供 getPublicKeys 端点发布，客户端据此离线验签 + 支持轮换）。
 *
 * @param {object|string} publicKey
 * @param {string} kid
 * @returns {{ kty: string, crv: string, x: string, use: string, alg: string, kid: string }} JWKS 中的一项
 */
function publicKeyToJwk(publicKey, kid) {
  const jwk = toPublicKey(publicKey).export({ format: 'jwk' })
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, use: 'sig', alg: ALG, kid }
}

module.exports = {
  ALG,
  ISS,
  signEntitlement,
  decodeEntitlement,
  verifyEntitlement,
  publicKeyToJwk,
  toPrivateKey,
  toPublicKey,
}
