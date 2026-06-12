import { describe, expect, it } from 'vitest'

import {
  assertCreateOrderInput,
  assertOutTradeNo,
  assertResourceMatchesOrder,
  assertTestAmount,
} from '../../cloudfunctions/wxpay-order/lib/validation.js'

describe('assertCreateOrderInput', () => {
  it('合法 native', () => {
    expect(assertCreateOrderInput({ planId: 'basic', billingCycle: 'month', payType: 'native' }))
      .toMatchObject({ planId: 'basic', billingCycle: 'month', payType: 'native' })
  })

  it('合法 jsapi（带 openid）', () => {
    const out = assertCreateOrderInput({ planId: 'basic', billingCycle: 'year', payType: 'jsapi', wxOpenid: 'ox-1' })
    expect(out.wxOpenid).toBe('ox-1')
  })

  it('非对象抛错', () => {
    expect(() => assertCreateOrderInput(null)).toThrow()
    expect(() => assertCreateOrderInput('x')).toThrow()
  })

  it('未知 planId 抛错', () => {
    expect(() => assertCreateOrderInput({ planId: 'enterprise', billingCycle: 'month', payType: 'native' }))
      .toThrow(/无效套餐/)
  })

  it('未知 billingCycle 抛错', () => {
    expect(() => assertCreateOrderInput({ planId: 'basic', billingCycle: 'week', payType: 'native' }))
      .toThrow(/无效计费周期/)
  })

  it('未知 payType 抛错', () => {
    expect(() => assertCreateOrderInput({ planId: 'basic', billingCycle: 'month', payType: 'apple-pay' }))
      .toThrow(/不支持的支付方式/)
  })

  it('wxOpenid 非字符串抛错', () => {
    expect(() => assertCreateOrderInput({ planId: 'basic', billingCycle: 'month', payType: 'jsapi', wxOpenid: 123 }))
      .toThrow()
  })
})

describe('assertTestAmount', () => {
  it.each([
    [1, 1],
    [9999, 9999],
    [10000, 10000],
    ['100', 100],
    [100.5, 101], // 四舍五入
  ])('合法值 %s -> %i', (input, expected) => {
    expect(assertTestAmount(input)).toBe(expected)
  })

  it.each([0, -1, 10001, 100000, 'abc', null, undefined, Number.NaN])('非法值 %s 抛错', (v) => {
    expect(() => assertTestAmount(v)).toThrow()
  })
})

describe('assertOutTradeNo', () => {
  it('合法订单号', () => {
    expect(assertOutTradeNo('YLF1234567890ABCDEF1234567890')).toBe('YLF1234567890ABCDEF1234567890')
  })

  it('非字符串抛错', () => {
    expect(() => assertOutTradeNo(123)).toThrow()
  })

  it('含非法字符抛错', () => {
    expect(() => assertOutTradeNo('YLF!@#$')).toThrow()
  })

  it('过短抛错', () => {
    expect(() => assertOutTradeNo('YLF')).toThrow()
  })

  it('过长抛错', () => {
    expect(() => assertOutTradeNo('A'.repeat(33))).toThrow()
  })
})

describe('assertResourceMatchesOrder', () => {
  const base = {
    expectedAppid: 'wx-app',
    expectedMchid: 'mch-1',
    resource: {
      appid: 'wx-app',
      mchid: 'mch-1',
      out_trade_no: 'YLF1234567890ABCDEF1234567890',
      amount: { total: 990 },
    },
    order: {
      outTradeNo: 'YLF1234567890ABCDEF1234567890',
      amount: 990,
    },
  }

  it('字段全匹配不抛错', () => {
    expect(() => assertResourceMatchesOrder(base)).not.toThrow()
  })

  it('appid 不匹配抛错', () => {
    const bad = { ...base, resource: { ...base.resource, appid: 'wx-other' } }
    expect(() => assertResourceMatchesOrder(bad)).toThrow(/appid 不匹配/)
  })

  it('mchid 不匹配抛错', () => {
    const bad = { ...base, resource: { ...base.resource, mchid: 'mch-2' } }
    expect(() => assertResourceMatchesOrder(bad)).toThrow(/mchid 不匹配/)
  })

  it('out_trade_no 不匹配抛错', () => {
    const bad = { ...base, resource: { ...base.resource, out_trade_no: 'OTHER1234567' } }
    expect(() => assertResourceMatchesOrder(bad)).toThrow(/out_trade_no/)
  })

  it('金额不匹配抛错（防替换订单）', () => {
    const bad = { ...base, resource: { ...base.resource, amount: { total: 1 } } }
    expect(() => assertResourceMatchesOrder(bad)).toThrow(/金额不匹配/)
  })

  it('金额缺失抛错', () => {
    const bad = { ...base, resource: { ...base.resource, amount: {} } }
    expect(() => assertResourceMatchesOrder(bad)).toThrow(/金额不匹配/)
  })
})
