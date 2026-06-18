/**
 * 设备授权码生命周期（OAuth 2.0 Device Authorization Grant 裁剪版，RFC 8628）。
 *
 * 角色分工：本模块只管「设备码」这张短生命周期的状态机（pending→approved/denied→consumed/expired），
 * 不直接 import devices/entitlement——签发 entitlement 与注册设备由 index.js 通过 `onApproved`
 * 回调注入，便于独立单测。db / now 依赖注入，兼容 fake db（仅等值 where）。
 */

'use strict'

const { generateUserCode, normalizeUserCode, randomToken, sha256hex } = require('./crypto')
const {
  CODE_STATUS,
  DEFAULT_DEVICE_CODE_TTL_SEC,
  DEFAULT_POLL_INTERVAL_SEC,
  DEFAULT_VERIFICATION_URL,
  DEVICE_CODES_COLLECTION,
  assertAppId,
  assertDeviceId,
  assertScope,
  isAnonUid,
  normalizeDeviceName,
} = require('./validation')

/** 取某 userCode 的记录（不存在返回 null） */
async function findByUserCode(db, userCode) {
  const normalized = normalizeUserCode(userCode)
  if (!normalized)
    return null
  const { data } = await db.collection(DEVICE_CODES_COLLECTION).where({ userCode: normalized }).limit(1).get()
  return Array.isArray(data) && data.length ? data[0] : null
}

/** 取某 deviceCode 的记录（按哈希比对） */
async function findByDeviceCode(db, deviceCode) {
  const { data } = await db
    .collection(DEVICE_CODES_COLLECTION)
    .where({ deviceCodeHash: sha256hex(deviceCode) })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length ? data[0] : null
}

function isExpired(doc, now) {
  return !doc || typeof doc.expireAt !== 'number' || doc.expireAt <= now
}

/**
 * 申请设备码（设备侧，无需登录）。
 *
 * @returns {Promise<{ deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn }>} 设备码下发结果
 */
async function startDeviceAuth(db, input, options = {}) {
  const appId = assertAppId(input.appId)
  const deviceId = assertDeviceId(input.deviceId)
  const scope = assertScope(input.scope)
  const deviceName = normalizeDeviceName(input.deviceName)

  const now = options.now || Date.now()
  const ttlSec = options.ttlSec || DEFAULT_DEVICE_CODE_TTL_SEC
  const interval = options.interval || DEFAULT_POLL_INTERVAL_SEC
  const verificationUri = options.verificationUri || DEFAULT_VERIFICATION_URL

  const deviceCode = randomToken(32)
  const { display, normalized } = generateUserCode(8)

  await db.collection(DEVICE_CODES_COLLECTION).add({
    deviceCodeHash: sha256hex(deviceCode),
    userCode: normalized,
    appId,
    deviceId,
    deviceName,
    scope,
    status: CODE_STATUS.PENDING,
    uid: null,
    interval,
    createdAt: now,
    expireAt: now + ttlSec * 1000,
    lastPolledAt: 0,
  })

  return {
    deviceCode,
    userCode: display,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(display)}`,
    interval,
    expiresIn: ttlSec,
  }
}

/**
 * 授权页展示用：根据 userCode 返回应用信息（不含敏感字段）。
 */
async function describeDevice(db, input, options = {}) {
  const now = options.now || Date.now()
  const doc = await findByUserCode(db, input.userCode)
  if (isExpired(doc, now))
    throw new Error('设备码不存在或已过期')
  return {
    appId: doc.appId,
    deviceName: doc.deviceName,
    scope: doc.scope,
    status: doc.status,
    expireAt: doc.expireAt,
  }
}

/**
 * 用户在已登录浏览器里点「授权」：把设备码绑定到当前 uid。
 */
async function approveDevice(db, input, options = {}) {
  const now = options.now || Date.now()
  const uid = input.uid
  if (isAnonUid(uid))
    throw new Error('请先登录')

  const doc = await findByUserCode(db, input.userCode)
  if (isExpired(doc, now))
    throw new Error('设备码不存在或已过期')
  if (doc.status === CODE_STATUS.CONSUMED)
    throw new Error('该设备码已被使用')
  if (doc.status !== CODE_STATUS.PENDING && doc.status !== CODE_STATUS.DENIED)
    throw new Error('设备码状态不可授权')

  await db
    .collection(DEVICE_CODES_COLLECTION)
    .where({ deviceCodeHash: doc.deviceCodeHash })
    .update({ status: CODE_STATUS.APPROVED, uid, approvedAt: now })
  return { ok: true }
}

/** 用户点「拒绝」。 */
async function denyDevice(db, input, options = {}) {
  const now = options.now || Date.now()
  const doc = await findByUserCode(db, input.userCode)
  if (isExpired(doc, now))
    throw new Error('设备码不存在或已过期')
  if (doc.status === CODE_STATUS.PENDING || doc.status === CODE_STATUS.APPROVED) {
    await db
      .collection(DEVICE_CODES_COLLECTION)
      .where({ deviceCodeHash: doc.deviceCodeHash })
      .update({ status: CODE_STATUS.DENIED, deniedAt: now })
  }
  return { ok: true }
}

/**
 * 设备轮询取凭证。
 *
 * `options.onApproved` 由 index.js 注入：授权通过后注册设备 + 签发 entitlement + 拉账户快照，
 * 形如 `async (doc) => ({ entitlement, deviceRefreshToken, account })`。
 *
 * @returns {Promise<{ status: string, entitlement?: string, deviceRefreshToken?: string, account?: object }>} 轮询结果（pending/slow_down/denied/expired/approved）
 */
async function pollDeviceToken(db, input, options = {}) {
  const now = options.now || Date.now()
  const deviceCode = input.deviceCode
  const deviceId = input.deviceId
  if (!deviceCode || !deviceId)
    return { status: CODE_STATUS.EXPIRED }

  const doc = await findByDeviceCode(db, deviceCode)
  // 不存在 / 设备绑定不符 / 已过期：一律按 expired 返回，不泄露细节
  if (!doc || doc.deviceId !== deviceId || isExpired(doc, now))
    return { status: CODE_STATUS.EXPIRED }

  // 轮询节流：快于 interval 的一半即回 slow_down（不更新 lastPolledAt，避免被刷）
  const interval = (doc.interval || DEFAULT_POLL_INTERVAL_SEC) * 1000
  if (doc.lastPolledAt && now - doc.lastPolledAt < interval / 2)
    return { status: 'slow_down', interval: doc.interval }
  await db.collection(DEVICE_CODES_COLLECTION).where({ deviceCodeHash: doc.deviceCodeHash }).update({ lastPolledAt: now })

  if (doc.status === CODE_STATUS.DENIED)
    return { status: CODE_STATUS.DENIED }
  if (doc.status === CODE_STATUS.CONSUMED)
    return { status: CODE_STATUS.EXPIRED } // 一次性：已消费的码不再发凭证
  if (doc.status !== CODE_STATUS.APPROVED)
    return { status: CODE_STATUS.PENDING }

  // approved：先标记 consumed（一次性），再签发——即便签发后客户端没收到，也不会重复发码
  await db.collection(DEVICE_CODES_COLLECTION).where({ deviceCodeHash: doc.deviceCodeHash }).update({ status: CODE_STATUS.CONSUMED, consumedAt: now })
  const issued = await options.onApproved(doc)
  return { status: CODE_STATUS.APPROVED, ...issued }
}

module.exports = {
  findByUserCode,
  findByDeviceCode,
  startDeviceAuth,
  describeDevice,
  approveDevice,
  denyDevice,
  pollDeviceToken,
}
