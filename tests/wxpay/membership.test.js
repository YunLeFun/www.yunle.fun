import { describe, expect, it } from 'vitest'

import {
  addBillingCycle,
  BILLING_TIME_ZONE,
  computeNewExpireAt,
  computeNewMembershipPeriod,
  getBillingAnchorDay,
  isMembershipActive,
} from '../../cloudfunctions/wxpay-order/lib/membership.js'

function shanghai(value) {
  return Date.parse(`${value}+08:00`)
}

describe('isMembershipActive', () => {
  it('过期返回 false', () => {
    expect(isMembershipActive(1000, 2000)).toBe(false)
  })

  it('刚好相等返回 false（避免 0 ms 残留）', () => {
    expect(isMembershipActive(1000, 1000)).toBe(false)
  })

  it('未到期返回 true', () => {
    expect(isMembershipActive(2000, 1000)).toBe(true)
  })

  it('null / undefined / NaN 返回 false', () => {
    expect(isMembershipActive(null, 1)).toBe(false)
    expect(isMembershipActive(undefined, 1)).toBe(false)
    expect(isMembershipActive(Number.NaN, 1)).toBe(false)
  })
})

describe('computeNewExpireAt', () => {
  const NOW = shanghai('2026-07-22T10:30:45.123')

  it('首次购买月付：从 now 顺延一个自然月', () => {
    expect(computeNewExpireAt({ current: null, cycle: 'month', now: NOW }))
      .toBe(shanghai('2026-08-22T10:30:45.123'))
  })

  it('首次购买年付：从 now 顺延一个自然年', () => {
    expect(computeNewExpireAt({ current: undefined, cycle: 'year', now: NOW }))
      .toBe(shanghai('2027-07-22T10:30:45.123'))
  })

  it('未到期续费：从当前到期日累加', () => {
    const current = shanghai('2026-08-05T08:00:00.000')
    expect(computeNewExpireAt({ current, cycle: 'month', now: NOW }))
      .toBe(shanghai('2026-09-05T08:00:00.000'))
  })

  it('已过期续费：从 now 起累加（不补偿过期段）', () => {
    const current = shanghai('2026-07-01T08:00:00.000')
    expect(computeNewExpireAt({ current, cycle: 'month', now: NOW }))
      .toBe(shanghai('2026-08-22T10:30:45.123'))
  })

  it('连续购买保留原账单日，月末不会永久漂移', () => {
    const jan31 = shanghai('2026-01-31T00:30:00.000')
    const after1 = computeNewMembershipPeriod({ current: null, cycle: 'month', now: jan31 })
    const after2 = computeNewMembershipPeriod({
      current: after1.expireAt,
      cycle: 'month',
      now: jan31 + 1,
      billingAnchorDay: after1.billingAnchorDay,
      billingAnchorIsMonthEnd: after1.billingAnchorIsMonthEnd,
    })
    expect(after1).toEqual({
      expireAt: shanghai('2026-02-28T00:30:00.000'),
      billingAnchorDay: 31,
      billingAnchorIsMonthEnd: true,
    })
    expect(after2).toEqual({
      expireAt: shanghai('2026-03-31T00:30:00.000'),
      billingAnchorDay: 31,
      billingAnchorIsMonthEnd: true,
    })
  })

  it('未到期月付 + 年付混合累加', () => {
    const after1 = computeNewMembershipPeriod({ current: null, cycle: 'month', now: NOW })
    const after2 = computeNewMembershipPeriod({
      current: after1.expireAt,
      cycle: 'year',
      now: NOW + 1,
      billingAnchorDay: after1.billingAnchorDay,
      billingAnchorIsMonthEnd: after1.billingAnchorIsMonthEnd,
    })
    expect(after2.expireAt).toBe(shanghai('2027-08-22T10:30:45.123'))
    expect(after2.billingAnchorDay).toBe(22)
    expect(after2.billingAnchorIsMonthEnd).toBe(false)
  })

  it('未知 cycle 抛错', () => {
    expect(() => computeNewExpireAt({ current: null, cycle: 'week', now: NOW })).toThrow()
  })

  it('now 非数字抛错', () => {
    expect(() => computeNewExpireAt({ current: null, cycle: 'month', now: 'x' })).toThrow(TypeError)
  })
})

describe('自然周期边界', () => {
  it('初始购买日在月末时，后续周期始终落在月末', () => {
    const april30 = shanghai('2026-04-30T10:00:00.000')
    const after1 = computeNewMembershipPeriod({ current: null, cycle: 'month', now: april30 })
    const after2 = computeNewMembershipPeriod({
      current: after1.expireAt,
      cycle: 'month',
      now: april30 + 1,
      billingAnchorDay: after1.billingAnchorDay,
      billingAnchorIsMonthEnd: after1.billingAnchorIsMonthEnd,
    })

    expect(after1).toEqual({
      expireAt: shanghai('2026-05-31T10:00:00.000'),
      billingAnchorDay: 30,
      billingAnchorIsMonthEnd: true,
    })
    expect(after2.expireAt).toBe(shanghai('2026-06-30T10:00:00.000'))
  })

  it('明确使用 Asia/Shanghai 账单日，包括凌晨的 UTC 跨日场景', () => {
    const jan31Early = shanghai('2026-01-31T00:30:00.000')
    expect(BILLING_TIME_ZONE).toBe('Asia/Shanghai')
    expect(getBillingAnchorDay(jan31Early)).toBe(31)
    expect(addBillingCycle(jan31Early, 'month', 31))
      .toBe(shanghai('2026-02-28T00:30:00.000'))
  })

  it('闰年 1 月 30 日顺延至 2 月 29 日，下一期恢复 30 日', () => {
    const jan30 = shanghai('2024-01-30T12:00:00.000')
    const feb = addBillingCycle(jan30, 'month', 30)
    expect(feb).toBe(shanghai('2024-02-29T12:00:00.000'))
    expect(addBillingCycle(feb, 'month', 30)).toBe(shanghai('2024-03-30T12:00:00.000'))
  })

  it('历史记录已有账单日但缺少月末标记时，不把短月到期日误判为粘附月末', () => {
    const period = computeNewMembershipPeriod({
      current: shanghai('2026-02-28T10:00:00.000'),
      cycle: 'month',
      now: shanghai('2026-02-01T10:00:00.000'),
      billingAnchorDay: 30,
    })
    expect(period).toEqual({
      expireAt: shanghai('2026-03-30T10:00:00.000'),
      billingAnchorDay: 30,
      billingAnchorIsMonthEnd: false,
    })
  })

  it('2 月 29 日年付在平年取月末，并保留 29 日锚点', () => {
    const leapDay = shanghai('2024-02-29T18:00:00.000')
    const after1 = computeNewMembershipPeriod({ current: null, cycle: 'year', now: leapDay })
    const after2 = computeNewMembershipPeriod({
      current: after1.expireAt,
      cycle: 'year',
      now: leapDay + 1,
      billingAnchorDay: after1.billingAnchorDay,
      billingAnchorIsMonthEnd: after1.billingAnchorIsMonthEnd,
    })
    expect(after1).toEqual({
      expireAt: shanghai('2025-02-28T18:00:00.000'),
      billingAnchorDay: 29,
      billingAnchorIsMonthEnd: true,
    })
    expect(after2).toEqual({
      expireAt: shanghai('2026-02-28T18:00:00.000'),
      billingAnchorDay: 29,
      billingAnchorIsMonthEnd: true,
    })
  })

  it('过期后重新购买会以本次购买日重置账单日', () => {
    const period = computeNewMembershipPeriod({
      current: shanghai('2026-03-31T10:00:00.000'),
      cycle: 'month',
      now: shanghai('2026-04-15T09:00:00.000'),
      billingAnchorDay: 31,
    })
    expect(period).toEqual({
      expireAt: shanghai('2026-05-15T09:00:00.000'),
      billingAnchorDay: 15,
      billingAnchorIsMonthEnd: false,
    })
  })
})
