import { describe, expect, it } from 'vitest'

import {
  CYCLE_DURATION_DAYS,
  DAY_MS,
  getCycleDurationMs,
  getPlanAmount,
  PLAN_PRICES,
} from '../../cloudfunctions/wxpay-order/lib/plans.js'

// eslint-disable-next-line test/prefer-lowercase-title
describe('PLAN_PRICES', () => {
  it('包含 basic 套餐', () => {
    expect(PLAN_PRICES.basic).toMatchObject({ month: 990, year: 9990 })
  })

  it('对象被冻结，避免运行时改动金额', () => {
    expect(() => {
      PLAN_PRICES.basic.month = 1
    }).toThrow()
  })
})

describe('getPlanAmount', () => {
  it.each([
    ['basic', 'month', 990],
    ['basic', 'year', 9990],
  ])('%s/%s -> %i 分', (planId, cycle, amount) => {
    expect(getPlanAmount(planId, cycle)).toBe(amount)
  })

  it('未知套餐抛错', () => {
    expect(() => getPlanAmount('pro', 'month')).toThrow(/无效套餐/)
  })

  it('未知周期抛错', () => {
    expect(() => getPlanAmount('basic', 'week')).toThrow(/无效计费周期/)
  })
})

describe('getCycleDurationMs', () => {
  it('月付 = 31 天毫秒数', () => {
    expect(getCycleDurationMs('month')).toBe(CYCLE_DURATION_DAYS.month * DAY_MS)
  })

  it('年付 = 366 天毫秒数', () => {
    expect(getCycleDurationMs('year')).toBe(CYCLE_DURATION_DAYS.year * DAY_MS)
  })

  it('未知周期抛错', () => {
    expect(() => getCycleDurationMs('week')).toThrow(/无效计费周期/)
  })
})
