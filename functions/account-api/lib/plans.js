/**
 * 套餐价格 & 会员时长配置。
 *
 * 此模块为业务真相源（source of truth），前端 `app/types/payment.ts` 应保持同步。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

/** 会员套餐价格表（单位：分），key 即会员等级 level */
const PLAN_PRICES = Object.freeze({
  basic: Object.freeze({ month: 990, year: 9990 }),
})

/** 会员套餐价格表别名（语义更清晰，等价于 PLAN_PRICES） */
const MEMBERSHIP_PRICES = PLAN_PRICES

/** 云币汇率：1 云币 = 10 分（即 100 云币 = 10 元），线性无折扣 */
const COIN_RATE_FEN = 10

/**
 * 云币充值套餐表：packId -> { amount(分), coin }
 * 约束：amount === coin * COIN_RATE_FEN（汇率守恒），由 getCoinPack 运行时校验。
 */
const COIN_PACKS = Object.freeze({
  coin_100: Object.freeze({ amount: 1000, coin: 100 }), //  10 元
  coin_500: Object.freeze({ amount: 5000, coin: 500 }), //  50 元
  coin_1000: Object.freeze({ amount: 10000, coin: 1000 }), // 100 元
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

/**
 * 校验并返回会员套餐价格（单位：分）。等价于 getPlanAmount，命名更贴合会员语义。
 *
 * @param {string} level 会员等级（如 'basic'）
 * @param {string} cycle 'month' | 'year'
 * @returns {number}
 */
function getMembershipAmount(level, cycle) {
  return getPlanAmount(level, cycle)
}

/**
 * 校验并返回云币充值套餐（含汇率守恒校验）。
 *
 * @param {string} packId
 * @returns {{ amount: number, coin: number }} amount 单位分，coin 到账云币数
 * @throws 套餐不存在或汇率配置错误时抛错
 */
function getCoinPack(packId) {
  const pack = COIN_PACKS[packId]
  if (!pack)
    throw new Error(`无效云币套餐: ${packId}`)
  if (pack.amount !== pack.coin * COIN_RATE_FEN)
    throw new Error(`云币套餐汇率配置错误: ${packId}（${pack.amount} !== ${pack.coin} * ${COIN_RATE_FEN}）`)
  return pack
}

module.exports = {
  PLAN_PRICES,
  MEMBERSHIP_PRICES,
  COIN_PACKS,
  COIN_RATE_FEN,
  CYCLE_DURATION_DAYS,
  DAY_MS,
  getPlanAmount,
  getMembershipAmount,
  getCoinPack,
  getCycleDurationMs,
}
