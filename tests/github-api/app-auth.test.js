import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  base64url,
  buildAppJwt,
  decodeKey,
  signState,
  verifyState,
} from '../../cloudfunctions/github-api/lib/app-auth.js'

// 用临时生成的 RSA 密钥对验证 JWT 签名逻辑，绝不使用任何真实凭据
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, // GitHub App 私钥即 PKCS#1
})

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

describe('github-api app-auth 纯函数', () => {
  it('base64url 不含 + / = 字符', () => {
    expect(base64url(Buffer.from([251, 255, 254, 0]))).not.toMatch(/[+/=]/)
  })

  it('decodeKey：PEM 原样、base64(PEM) 解码', () => {
    expect(decodeKey(privateKey)).toBe(privateKey.trim())
    const b64 = Buffer.from(privateKey, 'utf8').toString('base64')
    expect(decodeKey(b64)).toBe(privateKey.trim())
  })

  it('buildAppJwt：RS256 结构正确、iss/iat/exp 合规、签名可被公钥验证', () => {
    const now = 1_700_000_000_000
    const jwt = buildAppJwt({ appId: '1018931', privateKey, now })
    const [h, p, sig] = jwt.split('.')

    const header = JSON.parse(b64urlToBuf(h).toString('utf8'))
    const payload = JSON.parse(b64urlToBuf(p).toString('utf8'))
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(payload.iss).toBe('1018931')
    expect(payload.iat).toBe(Math.floor(now / 1000) - 60)
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600) // GitHub 上限 10min

    const verified = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, b64urlToBuf(sig))
    expect(verified).toBe(true)
  })

  it('signState/verifyState：往返取回 uid + origin', () => {
    const secret = 'unit-test-secret'
    const now = 1_700_000_000_000
    const state = signState({ uid: 'user_42', origin: 'http://localhost:3000', secret, now })
    expect(verifyState({ state, secret, now: now + 1000 })).toEqual({ uid: 'user_42', origin: 'http://localhost:3000' })
  })

  it('verifyState：签名被篡改 → 抛错', () => {
    const secret = 'unit-test-secret'
    const state = signState({ uid: 'u1', secret })
    expect(() => verifyState({ state: `${state.slice(0, -2)}xy`, secret })).toThrow()
  })

  it('verifyState：换密钥 → 抛错', () => {
    const state = signState({ uid: 'u1', secret: 'secret-a' })
    expect(() => verifyState({ state, secret: 'secret-b' })).toThrow()
  })

  it('verifyState：超过 TTL → 抛错', () => {
    const secret = 'unit-test-secret'
    const now = 1_700_000_000_000
    const state = signState({ uid: 'u1', secret, now })
    expect(() => verifyState({ state, secret, now: now + 11 * 60 * 1000 })).toThrow()
  })
})
