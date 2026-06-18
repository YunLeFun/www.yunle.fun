/**
 * desktop-auth 入参校验与常量。集中放集合名、TTL/策略默认值、状态枚举与各种 assert。
 */

'use strict'

// ── 集合名 ──────────────────────────────────────────────
const DEVICE_CODES_COLLECTION = 'desktop_device_codes'
const DEVICES_COLLECTION = 'desktop_devices'

// ── 策略默认值（可被 index.js 用 env 覆盖）────────────────
const DEFAULT_DEVICE_CODE_TTL_SEC = 600 // 设备码有效期 10min
const DEFAULT_POLL_INTERVAL_SEC = 5 // 建议轮询间隔
const DEFAULT_ENTITLEMENT_TTL_SEC = 7 * 24 * 3600 // entitlement = 离线宽限期，默认 7 天
const DEFAULT_REFRESH_TTL_SEC = 90 * 24 * 3600 // deviceRefreshToken 有效期，默认 90 天
const DEFAULT_VERIFICATION_URL = 'https://www.yunle.fun/link'

// ── 状态机 ──────────────────────────────────────────────
const CODE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
})

const SUPPORTED_SCOPES = ['membership', 'coin']

/** 匿名 / 占位身份：绝不能绑定设备、扣费或读账户（与 account-api 的 ANON_UIDS 对齐） */
const ANON_UIDS = new Set(['', 'anon'])
function isAnonUid(uid) {
  return typeof uid !== 'string' || ANON_UIDS.has(uid)
}

/** appId：小写字母/数字/-/_，≤32 位（与子应用接入约定一致） */
function assertAppId(appId) {
  if (typeof appId !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(appId))
    throw new Error('appId 非法（仅小写字母/数字/-/_，≤32 位）')
  return appId
}

/** deviceId：安装级稳定随机串，8~128 位 [A-Za-z0-9._:-] */
function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !/^[\w.:-]{8,128}$/.test(deviceId))
    throw new Error('deviceId 非法（8~128 位 [A-Za-z0-9._:-]）')
  return deviceId
}

/** deviceName：可选展示名，截断到 64 字符 */
function normalizeDeviceName(name) {
  if (typeof name !== 'string')
    return ''
  return name.trim().slice(0, 64)
}

/** scope：SUPPORTED_SCOPES 子集，缺省给全集 */
function assertScope(scope) {
  if (scope == null)
    return [...SUPPORTED_SCOPES]
  if (!Array.isArray(scope))
    throw new Error('scope 必须是数组')
  const out = [...new Set(scope)]
  for (const s of out) {
    if (!SUPPORTED_SCOPES.includes(s))
      throw new Error(`不支持的 scope: ${s}`)
  }
  return out.length ? out : [...SUPPORTED_SCOPES]
}

/** 扣费金额：正整数 */
function assertAmount(amount) {
  const n = Number(amount)
  if (!Number.isInteger(n) || n <= 0)
    throw new Error('amount 必须为正整数')
  return n
}

/** bizId：可选幂等键，≤128 字符 */
function assertBizId(bizId) {
  if (bizId == null)
    return undefined
  if (typeof bizId !== 'string' || !bizId.trim() || bizId.length > 128)
    throw new Error('bizId 非法（非空字符串，≤128 位）')
  return bizId.trim()
}

module.exports = {
  DEVICE_CODES_COLLECTION,
  DEVICES_COLLECTION,
  DEFAULT_DEVICE_CODE_TTL_SEC,
  DEFAULT_POLL_INTERVAL_SEC,
  DEFAULT_ENTITLEMENT_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  DEFAULT_VERIFICATION_URL,
  CODE_STATUS,
  SUPPORTED_SCOPES,
  ANON_UIDS,
  isAnonUid,
  assertAppId,
  assertDeviceId,
  normalizeDeviceName,
  assertScope,
  assertAmount,
  assertBizId,
}
