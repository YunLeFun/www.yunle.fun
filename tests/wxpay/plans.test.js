import { describe, expect, it } from 'vitest'

import {
  getPlanAmount,
  PLAN_PRICES,
} from '../../cloudfunctions/wxpay-order/lib/plans.js'

// eslint-disable-next-line test/prefer-lowercase-title
describe('PLAN_PRICES', () => {
  it('包含 basic 套餐', () => {
    expect(PLAN_PRICES.basic).toMatchObject({ month: 1000, year: 10000 })
  })

  it('对象被冻结，避免运行时改动金额', () => {
    expect(() => {
      PLAN_PRICES.basic.month = 1
    }).toThrow()
  })
})

describe('getPlanAmount', () => {
  it.each([
    ['basic', 'month', 1000],
    ['basic', 'year', 10000],
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
