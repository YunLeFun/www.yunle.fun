/**
 * desktop-auth 入参校验与常量。集中放集合名、TTL/策略默认值、状态枚举与各种 assert。
 */

'use strict'

// ── 集合名 ──────────────────────────────────────────────
const DEVICE_CODES_COLLECTION = 'desktop_device_codes'
const DEVICES_COLLECTION = 'desktop_devices'
const REFRESH_TOKENS_COLLECTION = 'desktop_refresh_tokens'

// ── 策略默认值（可被 index.js 用 env 覆盖）────────────────
const DEFAULT_DEVICE_CODE_TTL_SEC = 600 // 设备码有效期 10min
const DEFAULT_POLL_INTERVAL_SEC = 5 // 建议轮询间隔
const DEFAULT_ENTITLEMENT_TTL_SEC = 7 * 24 * 3600 // entitlement = 离线宽限期，默认 7 天
const DEFAULT_REFRESH_IDLE_TTL_SEC = 30 * 24 * 3600
const DEFAULT_REFRESH_ABSOLUTE_TTL_SEC = 180 * 24 * 3600
const DEFAULT_VERIFICATION_URL = 'https://www.yunle.fun/link'

// ── 状态机 ──────────────────────────────────────────────
const CODE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
})

/** 匿名 / 占位身份：绝不能绑定设备或读取会员（与 account-api 的 ANON_UIDS 对齐） */
const ANON_UIDS = new Set(['', 'anon'])
function isAnonUid(uid) {
  return typeof uid !== 'string' || ANON_UIDS.has(uid)
}

/** deviceName：可选展示名，截断到 64 字符 */
function normalizeDeviceName(name) {
  if (typeof name !== 'string')
    return ''
  return name.trim().slice(0, 64)
}

module.exports = {
  DEVICE_CODES_COLLECTION,
  DEVICES_COLLECTION,
  REFRESH_TOKENS_COLLECTION,
  DEFAULT_DEVICE_CODE_TTL_SEC,
  DEFAULT_POLL_INTERVAL_SEC,
  DEFAULT_ENTITLEMENT_TTL_SEC,
  DEFAULT_REFRESH_IDLE_TTL_SEC,
  DEFAULT_REFRESH_ABSOLUTE_TTL_SEC,
  DEFAULT_VERIFICATION_URL,
  CODE_STATUS,
  ANON_UIDS,
  isAnonUid,
  normalizeDeviceName,
}
