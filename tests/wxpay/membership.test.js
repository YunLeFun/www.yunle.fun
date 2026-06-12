import { describe, expect, it } from 'vitest'

import {
  computeNewExpireAt,
  isMembershipActive,
} from '../../cloudfunctions/wxpay-order/lib/membership.js'
import { DAY_MS } from '../../cloudfunctions/wxpay-order/lib/plans.js'

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
  const NOW = 1_700_000_000_000

  it('首次购买月付：从 now 起 31 天', () => {
    expect(computeNewExpireAt({ current: null, cycle: 'month', now: NOW }))
      .toBe(NOW + 31 * DAY_MS)
  })

  it('首次购买年付：从 now 起 366 天', () => {
    expect(computeNewExpireAt({ current: undefined, cycle: 'year', now: NOW }))
      .toBe(NOW + 366 * DAY_MS)
  })

  it('未到期续费：从当前到期日累加', () => {
    const current = NOW + 10 * DAY_MS
    expect(computeNewExpireAt({ current, cycle: 'month', now: NOW }))
      .toBe(current + 31 * DAY_MS)
  })

  it('已过期续费：从 now 起累加（不补偿过期段）', () => {
    const current = NOW - 5 * DAY_MS
    expect(computeNewExpireAt({ current, cycle: 'month', now: NOW }))
      .toBe(NOW + 31 * DAY_MS)
  })

  it('未到期连续买两次月付 = 62 天', () => {
    const after1 = computeNewExpireAt({ current: null, cycle: 'month', now: NOW })
    const after2 = computeNewExpireAt({ current: after1, cycle: 'month', now: NOW + 10 })
    expect(after2 - NOW).toBe(62 * DAY_MS)
  })

  it('未到期月付 + 年付混合累加', () => {
    const after1 = computeNewExpireAt({ current: null, cycle: 'month', now: NOW })
    const after2 = computeNewExpireAt({ current: after1, cycle: 'year', now: NOW + 1 })
    expect(after2 - NOW).toBe((31 + 366) * DAY_MS)
  })

  it('未知 cycle 抛错', () => {
    expect(() => computeNewExpireAt({ current: null, cycle: 'week', now: NOW })).toThrow()
  })

  it('now 非数字抛错', () => {
    expect(() => computeNewExpireAt({ current: null, cycle: 'month', now: 'x' })).toThrow(TypeError)
  })
})
