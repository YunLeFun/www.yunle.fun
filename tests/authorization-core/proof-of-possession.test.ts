import type {
  AuthorizationError,
} from '../../packages/authorization-core/src/index'
import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'
import {
  createProofOfPossessionVerifier,
  deviceJwkThumbprint,
} from '../../packages/authorization-core/src/index'

const NOW = 1_700_000_000_000
const URL = 'https://api.yunle.fun/desktop-auth'

function makeProof(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const jwk = publicKey.export({ format: 'jwk' })
  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    typ: 'dpop+jwt',
    jwk,
    ...overrides.header as object,
  })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    htm: 'POST',
    htu: URL,
    iat: Math.floor(NOW / 1000),
    jti: 'proof-0123456789abcdef',
    ...overrides.payload as object,
  })).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return { jwk, proof: `${header}.${payload}.${signature}` }
}

describe('proof of possession', () => {
  it('verifies an ES256 DPoP proof and derives the RFC 7638 thumbprint', () => {
    const { jwk, proof } = makeProof()
    const verifier = createProofOfPossessionVerifier()

    expect(verifier.verify(proof, { method: 'POST', url: URL, now: NOW }))
      .toEqual({
        jti: 'proof-0123456789abcdef',
        jkt: deviceJwkThumbprint(jwk),
        publicJwk: jwk,
      })
  })

  it.each([
    [{ payload: { htm: 'GET' } }, 'proof_target_invalid'],
    [{ payload: { htu: 'https://evil.example/desktop-auth' } }, 'proof_target_invalid'],
    [{ payload: { iat: Math.floor(NOW / 1000) - 301 } }, 'proof_expired'],
    [{ header: { alg: 'none' } }, 'proof_invalid'],
  ])('rejects an invalid proof', (overrides, code) => {
    const { proof } = makeProof(overrides)
    const verifier = createProofOfPossessionVerifier()
    expect(() => verifier.verify(proof, { method: 'POST', url: URL, now: NOW }))
      .toThrowError(expect.objectContaining<Partial<AuthorizationError>>({ code }))
  })

  it('uses the canonical public members only for the thumbprint', () => {
    const { jwk } = makeProof()
    expect(deviceJwkThumbprint({ ...jwk, kid: 'ignored' }))
      .toBe(createHash('sha256').update(JSON.stringify({
        crv: 'P-256',
        kty: 'EC',
        x: jwk.x,
        y: jwk.y,
      })).digest('base64url'))
  })
})
