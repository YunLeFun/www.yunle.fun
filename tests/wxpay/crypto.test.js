import { describe, expect, it } from 'vitest'

import {
  decryptResource,
  generateNonceStr,
  generateOutTradeNo,
} from '../../cloudfunctions/wxpay-order/lib/crypto.js'
import { encryptResource } from '../_fixtures/wxpay.mjs'

const apiV3Key = '12345678901234567890123456789012' // 32 bytes

describe('generateNonceStr', () => {
  it('默认长度 32', () => {
    expect(generateNonceStr()).toHaveLength(32)
  })

  it('指定长度', () => {
    expect(generateNonceStr(8)).toHaveLength(8)
    expect(generateNonceStr(64)).toHaveLength(64)
  })

  it('字符只包含字母数字', () => {
    for (let i = 0; i < 50; i++)
      expect(generateNonceStr(32)).toMatch(/^[A-Z0-9]+$/i)
  })

  it('越界长度抛错', () => {
    expect(() => generateNonceStr(0)).toThrow(RangeError)
    expect(() => generateNonceStr(65)).toThrow(RangeError)
  })
})

describe('generateOutTradeNo', () => {
  it('以 YLF 开头', () => {
    expect(generateOutTradeNo()).toMatch(/^YLF\d{13}[a-f0-9]{16}$/)
  })

  it('长度在 6~32 间', () => {
    const no = generateOutTradeNo()
    expect(no.length).toBeGreaterThanOrEqual(6)
    expect(no.length).toBeLessThanOrEqual(32)
  })

  it('短时间内连续生成不重复（256 次取样）', () => {
    const set = new Set()
    for (let i = 0; i < 256; i++)
      set.add(generateOutTradeNo())
    expect(set.size).toBe(256)
  })
})

describe('decryptResource', () => {
  const plaintext = {
    mchid: '1234567890',
    appid: 'wxXXXX',
    out_trade_no: 'YLF1234567890ABCDEF1234567890',
    transaction_id: '420000000000000',
    trade_state: 'SUCCESS',
    amount: { total: 990, currency: 'CNY' },
  }

  it('能解密自加密的 resource', () => {
    const resource = encryptResource({ apiV3Key, plaintext })
    expect(decryptResource({ resource, apiV3Key })).toEqual(plaintext)
  })

  it('使用错误的 APIv3 Key 抛错', () => {
    const resource = encryptResource({ apiV3Key, plaintext })
    expect(() => decryptResource({ resource, apiV3Key: '00000000000000000000000000000000' }))
      .toThrow()
  })

  it('密钥长度错误抛错', () => {
    expect(() => decryptResource({ resource: { ciphertext: 'x', nonce: 'y' }, apiV3Key: 'short' }))
      .toThrow(/32 字节/)
  })

  it('resource 缺字段抛错', () => {
    expect(() => decryptResource({ resource: { ciphertext: '' }, apiV3Key }))
      .toThrow(/缺失/)
  })

  it('ciphertext 被篡改抛错', () => {
    const resource = encryptResource({ apiV3Key, plaintext })
    resource.ciphertext = `${resource.ciphertext.slice(0, -8)}AAAAAAAA`
    expect(() => decryptResource({ resource, apiV3Key })).toThrow()
  })
})
