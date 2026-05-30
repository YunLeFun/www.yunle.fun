/**
 * 会员状态计算（纯函数，无副作用）。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { getCycleDurationMs } = require('./plans')

/**
 * 判定指定时刻会员是否仍有效
 *
 * @param {number|undefined|null} expireAt
 * @param {number} now
 * @returns {boolean}
 */
function isMembershipActive(expireAt, now) {
  if (typeof expireAt !== 'number' || !Number.isFinite(expireAt))
    return false
  return expireAt > now
}

/**
 * 计算续费/新购后的新到期时间。
 *
 * 续费规则：当前未过期则从 `current` 累加，已过期/无记录则从 `now` 累加。
 * 时间单位：毫秒。
 *
 * @param {object} input
 * @param {number|null|undefined} input.current 当前到期时间戳
 * @param {string} input.cycle 'month' | 'year'
 * @param {number} input.now 当前时间戳
 * @returns {number} 新到期时间戳
 */
function computeNewExpireAt({ current, cycle, now }) {
  if (typeof now !== 'number' || !Number.isFinite(now))
    throw new TypeError('computeNewExpireAt: now 必须为数字')
  const base = isMembershipActive(current, now) ? current : now
  return base + getCycleDurationMs(cycle)
}

module.exports = {
  isMembershipActive,
  computeNewExpireAt,
}
