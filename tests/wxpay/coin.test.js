import { describe, expect, it } from 'vitest'

import {
  COIN_PACKS,
  COIN_RATE_FEN,
  getCoinPack,
  getMembershipAmount,
} from '../../cloudfunctions/wxpay-order/lib/plans.js'
import {
  assertAppId,
  assertDeductCoinInput,
  assertMembershipOrderInput,
  assertRechargeCoinInput,
} from '../../cloudfunctions/wxpay-order/lib/validation.js'

describe('云币套餐定价', () => {
  it('汇率为 10 分/云币（100 云币 = 10 元）', () => {
    expect(COIN_RATE_FEN).toBe(10)
  })

  it.each(Object.keys(COIN_PACKS))('套餐 %s 满足 amount === coin * 10', (packId) => {
    const pack = getCoinPack(packId)
    expect(pack.amount).toBe(pack.coin * COIN_RATE_FEN)
  })

  it('coin_100 = 100 云币 / 1000 分', () => {
    expect(getCoinPack('coin_100')).toEqual({ amount: 1000, coin: 100 })
  })

  it('未知套餐抛错', () => {
    expect(() => getCoinPack('coin_999')).toThrow(/无效云币套餐/)
  })
})

describe('getMembershipAmount', () => {
  it('等价于 basic 套餐价', () => {
    expect(getMembershipAmount('basic', 'month')).toBe(990)
    expect(getMembershipAmount('basic', 'year')).toBe(9990)
  })
})

describe('assertAppId', () => {
  it.each(['yunle', 'app-b', 'a_1', 'x'])('合法: %s', (id) => {
    expect(assertAppId(id)).toBe(id)
  })

  it.each(['', '带空格 x', 'a'.repeat(33), null, 123])('非法抛错: %s', (id) => {
    expect(() => assertAppId(id)).toThrow(/无效 appId/)
  })
})

describe('assertMembershipOrderInput', () => {
  it('接受 level 字段', () => {
    expect(assertMembershipOrderInput({ appId: 'yunle', level: 'basic', billingCycle: 'month', payType: 'native' }))
      .toMatchObject({ appId: 'yunle', level: 'basic', billingCycle: 'month', payType: 'native' })
  })

  it('兼容旧 planId 字段', () => {
    expect(assertMembershipOrderInput({ appId: 'yunle', planId: 'basic', billingCycle: 'year', payType: 'h5' }))
      .toMatchObject({ level: 'basic', billingCycle: 'year' })
  })

  it('缺 appId 抛错', () => {
    expect(() => assertMembershipOrderInput({ level: 'basic', billingCycle: 'month', payType: 'native' }))
      .toThrow(/无效 appId/)
  })

  it('无效套餐抛错', () => {
    expect(() => assertMembershipOrderInput({ appId: 'yunle', level: 'pro', billingCycle: 'month', payType: 'native' }))
      .toThrow(/无效会员套餐/)
  })
})

describe('assertRechargeCoinInput', () => {
  it('合法返回归一化结果', () => {
    expect(assertRechargeCoinInput({ appId: 'app-b', packId: 'coin_500', payType: 'jsapi' }))
      .toMatchObject({ appId: 'app-b', packId: 'coin_500', payType: 'jsapi' })
  })

  it('无效套餐抛错', () => {
    expect(() => assertRechargeCoinInput({ appId: 'a', packId: 'coin_x', payType: 'native' }))
      .toThrow(/无效云币套餐/)
  })

  it('无效支付方式抛错', () => {
    expect(() => assertRechargeCoinInput({ appId: 'a', packId: 'coin_100', payType: 'alipay' }))
      .toThrow(/不支持的支付方式/)
  })
})

describe('assertDeductCoinInput', () => {
  it('合法返回正整数 amount', () => {
    expect(assertDeductCoinInput({ appId: 'a', amount: 50, bizId: 'b1' }))
      .toEqual({ appId: 'a', amount: 50, bizId: 'b1' })
  })

  it('amount 非正抛错', () => {
    expect(() => assertDeductCoinInput({ appId: 'a', amount: 0 })).toThrow(/正整数/)
    expect(() => assertDeductCoinInput({ appId: 'a', amount: -5 })).toThrow(/正整数/)
  })

  it('bizId 非字符串抛错', () => {
    expect(() => assertDeductCoinInput({ appId: 'a', amount: 5, bizId: 123 })).toThrow(/bizId/)
  })
})
