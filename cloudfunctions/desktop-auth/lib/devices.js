/**
 * 已授权设备注册表 + entitlement 刷新（轮换 + 重用检测）。
 *
 * 最佳实践（OAuth 原生客户端）：
 *   - deviceRefreshToken 只存哈希、长效、每次刷新**轮换**。
 *   - **重用检测**：保留「上一枚已轮换出的 token」哈希；若它被再次使用，
 *     判定为泄露/被盗，**吊销整台设备**（refresh token rotation with reuse detection）。
 *
 * 不直接 import entitlement/account——签发由 index.js 通过 `buildEntitlement` 回调注入，便于单测。
 */

'use strict'

const { randomToken, sha256hex, timingSafeEqualHex } = require('./crypto')
const { DEFAULT_REFRESH_TTL_SEC, DEVICES_COLLECTION } = require('./validation')

/**
 * 注册（或重置）一台设备，签发新的 deviceRefreshToken（明文仅此一次返回）。
 *
 * @returns {Promise<{ refreshToken: string }>} 新签发的 refreshToken 明文
 */
async function registerDevice(db, { uid, appId, deviceId, deviceName, scope }, options = {}) {
  const now = options.now || Date.now()
  const refreshTtlSec = options.refreshTtlSec || DEFAULT_REFRESH_TTL_SEC
  const refreshToken = randomToken(32)
  const patch = {
    uid,
    appId,
    deviceId,
    deviceName: deviceName || '',
    scope: scope || [],
    refreshTokenHash: sha256hex(refreshToken),
    prevRefreshTokenHash: null,
    refreshExpireAt: now + refreshTtlSec * 1000,
    lastSeenAt: now,
    revokedAt: null,
  }

  const { data } = await db.collection(DEVICES_COLLECTION).where({ uid, appId, deviceId }).limit(1).get()
  if (Array.isArray(data) && data.length) {
    await db.collection(DEVICES_COLLECTION).where({ uid, appId, deviceId }).update(patch)
  }
  else {
    await db.collection(DEVICES_COLLECTION).add({ createdAt: now, ...patch })
  }
  return { refreshToken }
}

/**
 * 用 deviceRefreshToken 刷新 entitlement：校验 → 轮换 → 重新签发。
 *
 * `options.buildEntitlement` 由 index.js 注入：
 * `async ({ uid, appId, deviceId, scope, now }) => ({ entitlement, account })`。
 *
 * @returns {Promise<{ entitlement: string, deviceRefreshToken: string, account: object }>} 新 entitlement + 轮换后的 refreshToken + 最新账户快照
 */
async function refreshEntitlement(db, { deviceRefreshToken, deviceId }, options = {}) {
  const now = options.now || Date.now()
  const refreshTtlSec = options.refreshTtlSec || DEFAULT_REFRESH_TTL_SEC
  if (!deviceRefreshToken || !deviceId)
    throw new Error('refresh 参数缺失')

  const presentedHash = sha256hex(deviceRefreshToken)
  const { data } = await db.collection(DEVICES_COLLECTION).where({ deviceId }).get()
  const candidates = Array.isArray(data) ? data : []

  // 1) 命中「上一枚已轮换出的 token」→ 重用检测：吊销整台设备
  const reused = candidates.find(d => d.prevRefreshTokenHash && timingSafeEqualHex(presentedHash, d.prevRefreshTokenHash))
  if (reused) {
    await db.collection(DEVICES_COLLECTION).where({ uid: reused.uid, appId: reused.appId, deviceId }).update({ revokedAt: now, refreshTokenHash: null, prevRefreshTokenHash: null })
    const err = new Error('refresh token 重用，设备已吊销，请重新登录')
    err.code = 'revoked'
    throw err
  }

  // 2) 命中当前 token
  const device = candidates.find(d => d.refreshTokenHash && timingSafeEqualHex(presentedHash, d.refreshTokenHash))
  if (!device) {
    const err = new Error('refresh token 无效')
    err.code = 'invalid_grant'
    throw err
  }
  if (device.revokedAt) {
    const err = new Error('设备已被吊销，请重新登录')
    err.code = 'revoked'
    throw err
  }
  if (typeof device.refreshExpireAt === 'number' && device.refreshExpireAt <= now) {
    const err = new Error('登录已过期，请重新登录')
    err.code = 'expired'
    throw err
  }

  // 3) 轮换 token（旧的存进 prev 供下次重用检测）+ 滑动续期
  const nextToken = randomToken(32)
  await db.collection(DEVICES_COLLECTION).where({ uid: device.uid, appId: device.appId, deviceId }).update({
    prevRefreshTokenHash: device.refreshTokenHash,
    refreshTokenHash: sha256hex(nextToken),
    refreshExpireAt: now + refreshTtlSec * 1000,
    lastSeenAt: now,
  })

  // 4) 重新签发 entitlement（带最新账户快照）
  const { entitlement, account } = await options.buildEntitlement({
    uid: device.uid,
    appId: device.appId,
    deviceId,
    scope: device.scope || [],
    now,
  })
  return { entitlement, deviceRefreshToken: nextToken, account }
}

/**
 * 吊销设备（个人中心「已登录设备」移除 / 管理员封禁）。
 */
async function revokeDevice(db, { uid, appId, deviceId }, options = {}) {
  const now = options.now || Date.now()
  const { updated, modifiedCount } = await db
    .collection(DEVICES_COLLECTION)
    .where({ uid, appId, deviceId })
    .update({ revokedAt: now, refreshTokenHash: null, prevRefreshTokenHash: null })
  return { revoked: (updated || modifiedCount || 0) > 0 }
}

/**
 * 列出某账号已授权设备（脱敏：不含 token 哈希），供个人中心展示。
 */
async function listDevices(db, { uid }) {
  const { data } = await db.collection(DEVICES_COLLECTION).where({ uid }).get()
  return (Array.isArray(data) ? data : [])
    .filter(d => !d.revokedAt)
    .map(d => ({ appId: d.appId, deviceId: d.deviceId, deviceName: d.deviceName, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt }))
}

module.exports = {
  registerDevice,
  refreshEntitlement,
  revokeDevice,
  listDevices,
}
