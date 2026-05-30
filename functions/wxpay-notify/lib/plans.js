/**
 * 套餐价格 & 会员时长配置。
 *
 * 此模块为业务真相源（source of truth），前端 `app/types/payment.ts` 应保持同步。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

/** 套餐价格表（单位：分） */
const PLAN_PRICES = Object.freeze({
  basic: Object.freeze({ month: 990, year: 9990 }),
})

/** 各计费周期对应的会员有效期天数 */
const CYCLE_DURATION_DAYS = Object.freeze({
  month: 31,
  year: 366,
})

const DAY_MS = 86_400_000

/**
 * 校验并返回套餐价格（单位：分）
 *
 * @param {string} planId
 * @param {string} cycle
 * @returns {number}
 * @throws 如果套餐或周期无效
 */
function getPlanAmount(planId, cycle) {
  const plan = PLAN_PRICES[planId]
  if (!plan)
    throw new Error(`无效套餐: ${planId}`)
  const amount = plan[cycle]
  if (typeof amount !== 'number')
    throw new Error(`无效计费周期: ${cycle}`)
  return amount
}

/**
 * 返回某计费周期对应的毫秒数
 *
 * @param {string} cycle
 * @returns {number}
 */
function getCycleDurationMs(cycle) {
  const days = CYCLE_DURATION_DAYS[cycle]
  if (typeof days !== 'number')
    throw new Error(`无效计费周期: ${cycle}`)
  return days * DAY_MS
}

module.exports = {
  PLAN_PRICES,
  CYCLE_DURATION_DAYS,
  DAY_MS,
  getPlanAmount,
  getCycleDurationMs,
}
