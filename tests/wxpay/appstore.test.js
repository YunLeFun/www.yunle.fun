import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assertGrantablePayload,
  buildApiToken,
  decodeJwsPayload,
  getTransactionInfo,
} from '../../functions/wxpay-order/lib/appstore.js'

/** 构造一个仅 payload 有效的 JWS（签名为占位，decode 不校验签名） */
function makeJws(payload) {
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'ES256' })}.${enc(payload)}.${Buffer.from('sig').toString('base64url')}`
}

/** 生成临时 EC P-256 密钥对（App Store Connect API Key 同曲线） */
function makeEcKeyPair() {
  return crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

const CONFIG = {
  issuerId: 'issuer-1',
  keyId: 'KEY1',
  privateKeyPem: makeEcKeyPair().privateKey,
  bundleId: 'fun.yunle.apps',
}

describe('decodeJwsPayload', () => {
  it('解码合法 JWS 的 payload', () => {
    const jws = makeJws({ transactionId: '123', productId: 'fun.yunle.apps.coin_100' })
    expect(decodeJwsPayload(jws)).toEqual({ transactionId: '123', productId: 'fun.yunle.apps.coin_100' })
  })

  it('非法输入抛错', () => {
    expect(() => decodeJwsPayload('')).toThrow()
    expect(() => decodeJwsPayload('a.b')).toThrow('JWS 格式错误')
    expect(() => decodeJwsPayload('a.!!!.c')).toThrow()
  })
})

describe('buildApiToken', () => {
  it('生成可被公钥验证的 ES256 JWT', () => {
    const { publicKey, privateKey } = makeEcKeyPair()
    const now = 1750000000000
    const token = buildApiToken({ ...CONFIG, privateKeyPem: privateKey, now })
    const [h, p, s] = token.split('.')

    const header = JSON.parse(Buffer.from(h, 'base64url').toString())
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY1', typ: 'JWT' })

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(payload.iss).toBe('issuer-1')
    expect(payload.aud).toBe('appstoreconnect-v1')
    expect(payload.bid).toBe('fun.yunle.apps')
    expect(payload.exp - payload.iat).toBe(600)

    const ok = crypto.verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: crypto.createPublicKey(publicKey), dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    )
    expect(ok).toBe(true)
  })

  it('缺少配置抛错', () => {
    expect(() => buildApiToken({ ...CONFIG, issuerId: '' })).toThrow('必填')
  })
})

describe('getTransactionInfo', () => {
  const txPayload = { transactionId: '888', bundleId: 'fun.yunle.apps', productId: 'fun.yunle.apps.coin_100' }

  function makeFetch(responsesByHost) {
    const calls = []
    const mock = async (url) => {
      calls.push(url)
      const entry = Object.entries(responsesByHost).find(([host]) => url.startsWith(host))
      const res = entry?.[1] ?? { status: 404 }
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        json: async () => res.body,
      }
    }
    mock.calls = calls
    return mock
  }

  it('生产环境命中直接返回', async () => {
    const httpFetch = makeFetch({
      'https://api.storekit.itunes.apple.com': { status: 200, body: { signedTransactionInfo: makeJws(txPayload) } },
    })
    const { payload, environment } = await getTransactionInfo({ transactionId: '888', config: CONFIG, fetch: httpFetch })
    expect(environment).toBe('Production')
    expect(payload.transactionId).toBe('888')
    expect(httpFetch.calls).toHaveLength(1)
  })

  it('生产 404 回退沙盒', async () => {
    const httpFetch = makeFetch({
      'https://api.storekit-sandbox.itunes.apple.com': { status: 200, body: { signedTransactionInfo: makeJws(txPayload) } },
    })
    const { environment } = await getTransactionInfo({ transactionId: '888', config: CONFIG, fetch: httpFetch })
    expect(environment).toBe('Sandbox')
    expect(httpFetch.calls).toHaveLength(2)
  })

  it('两个环境都 404 时抛错', async () => {
    const httpFetch = makeFetch({})
    await expect(getTransactionInfo({ transactionId: '888', config: CONFIG, fetch: httpFetch }))
      .rejects
      .toThrow('交易不存在')
  })

  it('鉴权失败抛错', async () => {
    const httpFetch = makeFetch({
      'https://api.storekit.itunes.apple.com': { status: 401 },
    })
    await expect(getTransactionInfo({ transactionId: '888', config: CONFIG, fetch: httpFetch }))
      .rejects
      .toThrow('鉴权失败')
  })

  it('transactionId 非纯数字直接拒绝', async () => {
    await expect(getTransactionInfo({ transactionId: '../evil', config: CONFIG, fetch: makeFetch({}) }))
      .rejects
      .toThrow('transactionId 非法')
  })
})

describe('assertGrantablePayload', () => {
  it('bundleId 不匹配抛错', () => {
    expect(() => assertGrantablePayload({ bundleId: 'com.evil.app' }, { bundleId: 'fun.yunle.apps' }))
      .toThrow('bundleId 不匹配')
  })

  it('已退款交易抛错', () => {
    expect(() => assertGrantablePayload(
      { bundleId: 'fun.yunle.apps', revocationDate: 1750000000000 },
      { bundleId: 'fun.yunle.apps' },
    )).toThrow('不可入账')
  })

  it('合法 payload 原样返回', () => {
    const payload = { bundleId: 'fun.yunle.apps', transactionId: '1' }
    expect(assertGrantablePayload(payload, { bundleId: 'fun.yunle.apps' })).toBe(payload)
  })
})
