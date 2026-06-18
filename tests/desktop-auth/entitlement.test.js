import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  decodeEntitlement,
  publicKeyToJwk,
  signEntitlement,
  verifyEntitlement,
} from '../../cloudfunctions/desktop-auth/lib/entitlement.js'

const NOW = 1_700_000_000_000
const KID = 'test-kid'

function makeKeys() {
  return crypto.generateKeyPairSync('ed25519')
}

function issue(privateKey, overrides = {}) {
  return signEntitlement({
    privateKey,
    kid: KID,
    uid: 'u1',
    appId: 'skykeeper',
    deviceId: 'device-abcdef12',
    scope: ['membership', 'coin'],
    membership: { isActive: true, level: 'basic', expireAt: NOW + 86_400_000 },
    now: NOW,
    ttlSec: 7 * 24 * 3600,
    jti: 'jti-1',
    ...overrides,
  })
}

describe('entitlement 签发与验签', () => {
  it('签发→验签 round-trip，载荷正确', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey)
    const payload = verifyEntitlement(token, {
      publicKeys: { [KID]: publicKey },
      now: NOW,
      expectedAud: 'skykeeper',
      expectedDeviceId: 'device-abcdef12',
    })
    expect(payload.sub).toBe('u1')
    expect(payload.aud).toBe('skykeeper')
    expect(payload.did).toBe('device-abcdef12')
    expect(payload.scope).toEqual(['membership', 'coin'])
    expect(payload.mbr).toEqual({ active: true, level: 'basic', expireAt: NOW + 86_400_000 })
    expect(payload.iss).toBe('yunle.fun')
  })

  it('载荷被篡改 → 验签失败', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey)
    const [h, p, s] = token.split('.')
    const tampered = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    tampered.mbr.active = true
    tampered.sub = 'attacker'
    const forged = `${h}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${s}`
    expect(() => verifyEntitlement(forged, { publicKeys: { [KID]: publicKey }, now: NOW }))
      .toThrow(/签名无效/)
  })

  it('用另一把公钥 → 验签失败', () => {
    const { privateKey } = makeKeys()
    const other = makeKeys()
    const token = issue(privateKey)
    expect(() => verifyEntitlement(token, { publicKeys: { [KID]: other.publicKey }, now: NOW }))
      .toThrow(/签名无效/)
  })

  it('alg-confusion：非 EdDSA 头部一律拒绝', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey)
    const [, p, s] = token.split('.')
    const evilHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: KID })).toString('base64url')
    const forged = `${evilHeader}.${p}.${s}`
    expect(() => verifyEntitlement(forged, { publicKeys: { [KID]: publicKey }, now: NOW }))
      .toThrow(/算法不被接受/)
  })

  it('未知 kid → 拒绝', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey)
    expect(() => verifyEntitlement(token, { publicKeys: { 'other-kid': publicKey }, now: NOW }))
      .toThrow(/kid 未知/)
  })

  it('过期（超出宽限 + 时钟偏移）→ 拒绝', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey, { ttlSec: 10 })
    const later = NOW + 10_000 + 61_000 // 超过 exp + 默认 60s skew
    expect(() => verifyEntitlement(token, { publicKeys: { [KID]: publicKey }, now: later }))
      .toThrow(/已过期/)
  })

  it('aud / deviceId 不匹配 → 拒绝', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey)
    expect(() => verifyEntitlement(token, { publicKeys: { [KID]: publicKey }, now: NOW, expectedAud: 'other-app' }))
      .toThrow(/aud 不匹配/)
    expect(() => verifyEntitlement(token, { publicKeys: { [KID]: publicKey }, now: NOW, expectedDeviceId: 'other-device' }))
      .toThrow(/设备不匹配/)
  })

  it('无账号（sub=null）也能签发（离线兑换场景）', () => {
    const { publicKey, privateKey } = makeKeys()
    const token = issue(privateKey, { uid: null })
    const payload = verifyEntitlement(token, { publicKeys: { [KID]: publicKey }, now: NOW })
    expect(payload.sub).toBeNull()
  })

  it('decodeEntitlement 不验签即可读 header/payload', () => {
    const { privateKey } = makeKeys()
    const token = issue(privateKey)
    const { header, payload } = decodeEntitlement(token)
    expect(header).toMatchObject({ alg: 'EdDSA', typ: 'JWT', kid: KID })
    expect(payload.aud).toBe('skykeeper')
  })

  it('publicKeyToJwk 导出标准 OKP/Ed25519 JWK', () => {
    const { publicKey } = makeKeys()
    const jwk = publicKeyToJwk(publicKey, KID)
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid: KID })
    expect(typeof jwk.x).toBe('string')
  })
})
