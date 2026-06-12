/**
 * 微信支付签名 & 验签纯函数测试
 */

import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  buildAuthorizationHeader,
  buildCallbackSigningString,
  buildRequestSigningString,
  normalizePrivateKey,
  parsePlatformCertificates,
  signWithPrivateKey,
  verifyCallbackSignature,
} from '../../cloudfunctions/wxpay-order/lib/signature.js'
import { makeKeyPair, signCallback } from '../_fixtures/wxpay.mjs'

describe('normalizePrivateKey', () => {
  const pkcs8 = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
-----END PRIVATE KEY-----`

  it('保留正常多行 PEM 不变（除去首尾空白）', () => {
    expect(normalizePrivateKey(pkcs8)).toBe(pkcs8)
  })

  it('将转义的 \\n 还原为真实换行', () => {
    const escaped = pkcs8.replace(/\n/g, '\\n')
    expect(normalizePrivateKey(escaped)).toBe(pkcs8)
  })

  it('单行 base64 自动折行并补 PEM 头尾', () => {
    const oneline = 'AAAABBBBCCCCDDDD'.repeat(8) // 128 chars
    const result = normalizePrivateKey(oneline)
    expect(result).toMatch(/^-----BEGIN PRIVATE KEY-----\n/)
    expect(result).toMatch(/\n-----END PRIVATE KEY-----$/)
    const lines = result.split('\n')
    // 中间内容每行 64 字符
    expect(lines[1]).toHaveLength(64)
    expect(lines[2]).toHaveLength(64)
  })

  it('兼容 PKCS#1 RSA PRIVATE KEY 标记', () => {
    const oneline = `-----BEGIN RSA PRIVATE KEY----- ${'X'.repeat(64)} -----END RSA PRIVATE KEY-----`
    const result = normalizePrivateKey(oneline)
    expect(result).toContain('-----BEGIN PRIVATE KEY-----')
    expect(result).toContain('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
  })

  it('非字符串入参抛错', () => {
    expect(() => normalizePrivateKey(null)).toThrow(TypeError)
    expect(() => normalizePrivateKey('')).toThrow(TypeError)
  })
})

describe('buildRequestSigningString / buildCallbackSigningString', () => {
  it('请求签名串格式严格匹配官方文档', () => {
    expect(buildRequestSigningString({
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      timestamp: '1234567890',
      nonce: 'abc',
      body: '{"a":1}',
    })).toBe('POST\n/v3/pay/transactions/native\n1234567890\nabc\n{"a":1}\n')
  })

  it('回调验签串格式严格匹配官方文档', () => {
    expect(buildCallbackSigningString({
      timestamp: '1234567890',
      nonce: 'abc',
      body: 'X',
    })).toBe('1234567890\nabc\nX\n')
  })

  it('空 body 也保留尾随换行', () => {
    expect(buildRequestSigningString({
      method: 'GET',
      urlPath: '/v3/foo',
      timestamp: '1',
      nonce: 'n',
      body: '',
    })).toBe('GET\n/v3/foo\n1\nn\n\n')
  })
})

describe('buildAuthorizationHeader', () => {
  const { privateKey } = makeKeyPair()

  it('产出符合微信规范的 Header', () => {
    const header = buildAuthorizationHeader({
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      body: '{}',
      mchId: '1234567890',
      serialNo: 'ABCDEF',
      privateKey,
      timestamp: '1700000000',
      nonceStr: 'nonce123',
    })
    expect(header).toMatch(/^WECHATPAY2-SHA256-RSA2048 /)
    expect(header).toContain('mchid="1234567890"')
    expect(header).toContain('serial_no="ABCDEF"')
    expect(header).toContain('timestamp="1700000000"')
    expect(header).toContain('nonce_str="nonce123"')
    expect(header).toMatch(/signature="[^"]+"/)
  })

  it('缺少配置时抛错', () => {
    expect(() => buildAuthorizationHeader({
      method: 'POST',
      urlPath: '/x',
      body: '',
      mchId: '',
      serialNo: 'X',
      privateKey: 'Y',
      timestamp: '1',
      nonceStr: 'n',
    })).toThrow(/配置缺失/)
  })
})

describe('parsePlatformCertificates', () => {
  it('解析 JSON 对象', () => {
    const out = parsePlatformCertificates(JSON.stringify({
      ABC: '-----BEGIN PUBLIC KEY-----\nXYZ\n-----END PUBLIC KEY-----',
    }))
    expect(out.ABC).toContain('XYZ')
  })

  // eslint-disable-next-line test/prefer-lowercase-title
  it('JSON value 中 \\n 还原为真换行', () => {
    const out = parsePlatformCertificates('{"SN1":"line1\\nline2"}')
    expect(out.SN1).toBe('line1\nline2')
  })

  it('支持 SERIAL|PEM 简写', () => {
    const out = parsePlatformCertificates('SN2|-----BEGIN PUBLIC KEY-----\\nA\\n-----END PUBLIC KEY-----')
    expect(out.SN2).toBe('-----BEGIN PUBLIC KEY-----\nA\n-----END PUBLIC KEY-----')
  })

  it('空值返回空对象', () => {
    expect(parsePlatformCertificates(undefined)).toEqual({})
    expect(parsePlatformCertificates('')).toEqual({})
  })
})

describe('verifyCallbackSignature', () => {
  const { publicKey, privateKey } = makeKeyPair()
  const serial = 'TEST-SERIAL-001'
  const certificates = { [serial]: publicKey }
  const body = '{"event_type":"TRANSACTION.SUCCESS"}'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = 'nonce-xyz'
  const signature = signCallback({ privateKey, timestamp, nonce, body })

  it('合法签名 → ok', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial,
      timestamp,
      nonce,
      signature,
      body,
    })).toEqual({ ok: true })
  })

  it('缺 header → missing-header', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial: '',
      timestamp,
      nonce,
      signature,
      body,
    }).reason).toBe('missing-header')
  })

  it('未知证书序列号 → unknown-serial', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial: 'WRONG-SERIAL',
      timestamp,
      nonce,
      signature,
      body,
    }).reason).toBe('unknown-serial')
  })

  it('签名内容被篡改 → signature-mismatch', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial,
      timestamp,
      nonce,
      signature,
      body: `${body} tampered`,
    }).reason).toBe('signature-mismatch')
  })

  it('伪造的签名 → signature-mismatch', () => {
    const fake = crypto.randomBytes(256).toString('base64')
    expect(verifyCallbackSignature({
      certificates,
      serial,
      timestamp,
      nonce,
      signature: fake,
      body,
    }).reason).toBe('signature-mismatch')
  })

  it('时间戳超过容忍区间 → timestamp-out-of-tolerance', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial,
      timestamp: '1000000000',
      nonce,
      signature,
      body,
      toleranceSeconds: 60,
      nowSeconds: Math.floor(Date.now() / 1000),
    }).reason).toBe('timestamp-out-of-tolerance')
  })

  it('toleranceSeconds=0 时跳过时间校验', () => {
    expect(verifyCallbackSignature({
      certificates,
      serial,
      timestamp,
      nonce,
      signature,
      body,
      toleranceSeconds: 0,
    })).toEqual({ ok: true })
  })
})

describe('signWithPrivateKey 与 normalizePrivateKey 配合', () => {
  it('对单行 PEM 也能正确签名/验签', () => {
    const { publicKey, privateKey } = makeKeyPair()
    const onelinePrivate = privateKey.replace(/\n/g, '\\n')
    const sig = signWithPrivateKey('hello', onelinePrivate)
    expect(crypto.createVerify('RSA-SHA256').update('hello').verify(publicKey, sig, 'base64')).toBe(true)
  })
})
