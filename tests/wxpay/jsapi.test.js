import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { generateJsapiPayParams } from '../../cloudfunctions/wxpay-order/lib/jsapi.js'
import { makeKeyPair } from '../_fixtures/wxpay.mjs'

describe('generateJsapiPayParams', () => {
  const { publicKey, privateKey } = makeKeyPair()
  const base = {
    appId: 'wx-app',
    prepayId: 'wx20231114100000',
    privateKey,
    timestamp: '1700000000',
    nonceStr: 'nonce-1',
  }

  it('返回的 package 是 prepay_id=...', () => {
    expect(generateJsapiPayParams(base).package).toBe('prepay_id=wx20231114100000')
  })

  it('返回的 paySign 可被对应公钥验证', () => {
    const params = generateJsapiPayParams(base)
    const content = `${params.appId}\n${params.timeStamp}\n${params.nonceStr}\n${params.package}\n`
    const verified = crypto.createVerify('RSA-SHA256')
      .update(content)
      .verify(publicKey, params.paySign, 'base64')
    expect(verified).toBe(true)
  })

  it('signType 固定 RSA', () => {
    expect(generateJsapiPayParams(base).signType).toBe('RSA')
  })

  it('缺参数抛错', () => {
    expect(() => generateJsapiPayParams({ ...base, appId: '' })).toThrow()
    expect(() => generateJsapiPayParams({ ...base, prepayId: '' })).toThrow()
    expect(() => generateJsapiPayParams({ ...base, privateKey: '' })).toThrow()
  })
})
