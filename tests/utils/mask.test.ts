import { describe, expect, it } from 'vitest'
import { displayUserName, looksLikePhone, maskPhone } from '../../app/utils/mask'

describe('maskPhone', () => {
  it('脱敏标准 11 位手机号', () => {
    expect(maskPhone('15906608053')).toBe('159****8053')
    expect(maskPhone('13800138000')).toBe('138****8000')
  })

  it('容忍首尾空白', () => {
    expect(maskPhone('  15906608053 ')).toBe('159****8053')
  })

  it('非手机号但为 ≥7 位纯数字时保留首 3 尾 2', () => {
    expect(maskPhone('1234567')).toBe('123****67')
  })

  it('非数字/短字符串原样返回', () => {
    expect(maskPhone('云游君')).toBe('云游君')
    expect(maskPhone('')).toBe('')
  })
})

describe('looksLikePhone', () => {
  it('识别裸手机号', () => {
    expect(looksLikePhone('15906608053')).toBe(true)
  })

  it('普通昵称 / 空值不误判', () => {
    expect(looksLikePhone('云游君')).toBe(false)
    expect(looksLikePhone('')).toBe(false)
    expect(looksLikePhone(null)).toBe(false)
    expect(looksLikePhone(undefined)).toBe(false)
    // 12345678901 不是合法手机号段（1 后非 3-9）
    expect(looksLikePhone('12345678901')).toBe(false)
  })
})

describe('displayUserName', () => {
  it('手机号昵称 → 脱敏', () => {
    expect(displayUserName('15906608053')).toBe('159****8053')
  })

  it('正常昵称 → 原样', () => {
    expect(displayUserName('云游君')).toBe('云游君')
  })

  it('空昵称 → 占位名（默认 / 自定义）', () => {
    expect(displayUserName('')).toBe('云乐坊用户')
    expect(displayUserName(null)).toBe('云乐坊用户')
    expect(displayUserName(undefined, 'yunyoujun')).toBe('yunyoujun')
  })
})
