/**
 * 会员状态计算（纯函数，无副作用）。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

/**
 * 会员计费统一使用 Asia/Shanghai 的自然月 / 自然年。
 *
 * 时间戳仍以 UTC 毫秒存储；这里只在做日历运算时平移到东八区。中国大陆没有夏令时，
 * 固定偏移可避免云函数运行时所在时区影响结果，也避免凌晨购买被算到前一 UTC 日期。
 */
const BILLING_TIME_ZONE = 'Asia/Shanghai'
const BILLING_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000

const BILLING_CYCLE_MONTHS = Object.freeze({
  month: 1,
  year: 12,
})

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
 * 取时间戳在计费时区中的日（1~31）。
 *
 * @param {number} timestamp UTC 毫秒时间戳
 * @returns {number}
 */
function getBillingAnchorDay(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
    throw new TypeError('getBillingAnchorDay: timestamp 必须为数字')
  return new Date(timestamp + BILLING_TIME_ZONE_OFFSET_MS).getUTCDate()
}

/**
 * 指定时间是否为 Asia/Shanghai 当月最后一天。
 *
 * @param {number} timestamp UTC 毫秒时间戳
 * @returns {boolean}
 */
function isBillingMonthEnd(timestamp) {
  const local = new Date(timestamp + BILLING_TIME_ZONE_OFFSET_MS)
  const maxDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate()
  return local.getUTCDate() === maxDay
}

/**
 * 规范化账单锚点；历史记录缺字段时从当前周期末推导。
 *
 * @param {object} input
 * @param {number|null|undefined} input.billingAnchorDay
 * @param {boolean|null|undefined} input.billingAnchorIsMonthEnd
 * @param {number} input.base
 * @returns {{ billingAnchorDay: number, billingAnchorIsMonthEnd: boolean }}
 */
function resolveBillingAnchor({ billingAnchorDay, billingAnchorIsMonthEnd, base }) {
  const hasAnchorDay = Number.isInteger(billingAnchorDay) && billingAnchorDay >= 1 && billingAnchorDay <= 31
  const anchorDay = hasAnchorDay
    ? billingAnchorDay
    : getBillingAnchorDay(base)
  const anchorIsMonthEnd = typeof billingAnchorIsMonthEnd === 'boolean'
    ? billingAnchorIsMonthEnd
    // 已有 billingAnchorDay 的记录来自旧版“指定日 + 短月截断”模型，缺少新字段时
    // 保持原语义；两项都缺失的更早历史记录才从当前到期日推导月末策略。
    : hasAnchorDay ? false : isBillingMonthEnd(base)
  return {
    billingAnchorDay: anchorDay,
    billingAnchorIsMonthEnd: anchorIsMonthEnd,
  }
}

/**
 * 在 Asia/Shanghai 日历中增加一个计费周期，并保留本地时分秒。
 *
 * 目标月份没有锚点日期时取月末；锚点日期由会员记录持久化，所以
 * 1 月 31 日 -> 2 月 28/29 日 -> 3 月 31 日，不会永久漂移到 28/29 日。
 *
 * @param {number} base UTC 毫秒时间戳
 * @param {string} cycle 'month' | 'year'
 * @param {number|undefined|null} anchorDay 原始账单日（1~31）
 * @param {boolean} [anchorIsMonthEnd] 是否采用月末粘附策略，缺省为 false
 * @returns {number} 新的 UTC 毫秒时间戳
 */
function addBillingCycle(base, cycle, anchorDay, anchorIsMonthEnd = false) {
  if (typeof base !== 'number' || !Number.isFinite(base))
    throw new TypeError('addBillingCycle: base 必须为数字')
  const months = BILLING_CYCLE_MONTHS[cycle]
  if (typeof months !== 'number')
    throw new Error(`无效计费周期: ${cycle}`)

  const local = new Date(base + BILLING_TIME_ZONE_OFFSET_MS)
  const sourceYear = local.getUTCFullYear()
  const sourceMonth = local.getUTCMonth()
  const targetMonthIndex = sourceYear * 12 + sourceMonth + months
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12
  const targetMaxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const resolvedAnchor = resolveBillingAnchor({
    billingAnchorDay: anchorDay,
    billingAnchorIsMonthEnd: anchorIsMonthEnd,
    base,
  })
  const targetDay = resolvedAnchor.billingAnchorIsMonthEnd
    ? targetMaxDay
    : Math.min(resolvedAnchor.billingAnchorDay, targetMaxDay)

  const localTarget = Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  )
  return localTarget - BILLING_TIME_ZONE_OFFSET_MS
}

/**
 * 计算续费/新购后的计费周期。
 *
 * 当前会员有效时从原到期时间顺延并保留账单日；已过期或无记录时从 now 重新起算，
 * 同时将本次购买日在 Asia/Shanghai 的日期设为新的账单日。
 *
 * @param {object} input
 * @param {number|null|undefined} input.current 当前到期时间戳
 * @param {string} input.cycle 'month' | 'year'
 * @param {number} input.now 当前时间戳
 * @param {number|null|undefined} [input.billingAnchorDay] 原始账单日（1~31）
 * @param {boolean|null|undefined} [input.billingAnchorIsMonthEnd] 是否采用月末粘附策略
 * @returns {{ expireAt: number, billingAnchorDay: number, billingAnchorIsMonthEnd: boolean }}
 */
function computeNewMembershipPeriod({ current, cycle, now, billingAnchorDay, billingAnchorIsMonthEnd }) {
  if (typeof now !== 'number' || !Number.isFinite(now))
    throw new TypeError('computeNewMembershipPeriod: now 必须为数字')
  const active = isMembershipActive(current, now)
  const base = active ? current : now
  const anchor = active
    ? resolveBillingAnchor({ billingAnchorDay, billingAnchorIsMonthEnd, base })
    : resolveBillingAnchor({ base })
  return {
    expireAt: addBillingCycle(
      base,
      cycle,
      anchor.billingAnchorDay,
      anchor.billingAnchorIsMonthEnd,
    ),
    ...anchor,
  }
}

/**
 * 计算续费/新购后的新到期时间。
 *
 * 续费规则：当前未过期则从 `current` 累加，已过期/无记录则从 `now` 累加。
 * 计费单位：Asia/Shanghai 自然月 / 自然年。
 *
 * @param {object} input
 * @param {number|null|undefined} input.current 当前到期时间戳
 * @param {string} input.cycle 'month' | 'year'
 * @param {number} input.now 当前时间戳
 * @param {number|null|undefined} [input.billingAnchorDay] 原始账单日（1~31）
 * @returns {number} 新到期时间戳
 */
function computeNewExpireAt(input) {
  return computeNewMembershipPeriod(input).expireAt
}

module.exports = {
  BILLING_TIME_ZONE,
  BILLING_TIME_ZONE_OFFSET_MS,
  BILLING_CYCLE_MONTHS,
  isMembershipActive,
  getBillingAnchorDay,
  isBillingMonthEnd,
  resolveBillingAnchor,
  addBillingCycle,
  computeNewMembershipPeriod,
  computeNewExpireAt,
}
