import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assertionTtlSeconds,
  createIdentityAssertionRuntime,
  decodeSigningKey,
} from '../../cloudfunctions/sso-ticket/identity-assertion.js'

describe('sso-ticket identity assertion runtime', () => {
  it('accepts a base64 private JWK, signs a bounded assertion, and publishes public JWKS', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const privateJwk = privateKey.export({ format: 'jwk' })
    const encoded = Buffer.from(JSON.stringify(privateJwk)).toString('base64')
    const runtime = createIdentityAssertionRuntime({
      issuer: 'https://www.yunle.fun',
      signingKey: encoded,
      signingKid: 'identity-2026-07',
      publicKeys: '{}',
      ttlSeconds: '120',
      generateJti: () => 'jti-1',
      now: () => 1_000,
    })

    const token = runtime.sign({
      subject: 'user-1',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      nonce: 'n'.repeat(32),
    })
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    )

    expect(claims).toMatchObject({
      sub: 'user-1',
      aud: 'cms-web',
      phone_number_verified: true,
      account_status: 'active',
      exp: 121,
    })
    expect(claims).not.toHaveProperty('phone_number')
    expect(runtime.publicJwks()).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'EdDSA',
          kid: 'identity-2026-07',
          kty: 'OKP',
          use: 'sig',
        }),
      ],
    })
    expect(runtime.publicJwks().keys[0]).not.toHaveProperty('d')
  })

  it('fails closed without a signing key or kid and bounds the configured TTL', () => {
    expect(
      createIdentityAssertionRuntime({
        issuer: 'https://www.yunle.fun',
        signingKey: '',
        signingKid: 'identity-2026-07',
      }),
    ).toBeNull()
    expect(
      createIdentityAssertionRuntime({
        issuer: 'https://www.yunle.fun',
        signingKey: '{"kty":"OKP"}',
        signingKid: '../invalid',
      }),
    ).toBeNull()
    expect(
      createIdentityAssertionRuntime({
        issuer: 'https://www.yunle.fun',
        signingKey: '{"kty":"OKP"}',
        signingKid: '',
      }),
    ).toBeNull()
    expect(assertionTtlSeconds('30')).toBe(30)
    expect(assertionTtlSeconds('300')).toBe(300)
    expect(assertionTtlSeconds('301')).toBe(120)
    expect(assertionTtlSeconds('not-a-number')).toBe(120)
  })

  it('decodes PEM and JSON values while leaving invalid input for strict parsing', () => {
    const json = '{"kty":"OKP"}'
    expect(decodeSigningKey(Buffer.from(json).toString('base64'))).toBe(json)
    expect(decodeSigningKey(json)).toBe(json)
    expect(decodeSigningKey('not-a-key')).toBe('not-a-key')
  })
})
