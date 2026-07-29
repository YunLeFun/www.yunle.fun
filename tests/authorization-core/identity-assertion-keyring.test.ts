import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createIdentityAssertionKeyring } from '../../packages/authorization-core/src/index'

describe('web SSO identity assertion keyring', () => {
  it('signs only the minimum verified-account claims and publishes the verification key', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keyring = createIdentityAssertionKeyring({
      issuer: 'https://www.yunle.fun',
      active: { kid: 'sso-identity-2026-07', privateKey },
      verificationKeys: [],
      generateJti: () => 'identity-jti-1',
    })

    const token = keyring.signIdentityAssertion({
      subject: 'user-1',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      nonce: 'n'.repeat(32),
      phoneNumberVerified: true,
      accountStatus: 'active',
      now: 1_000,
      ttlSeconds: 120,
    })

    expect(
      keyring.verifyIdentityAssertion(token, {
        audience: 'cms-web',
        nonce: 'n'.repeat(32),
        now: 2_000,
      }),
    ).toEqual({
      iss: 'https://www.yunle.fun',
      sub: 'user-1',
      aud: 'cms-web',
      app_id: 'cms',
      scope: ['identity:bootstrap'],
      nonce: 'n'.repeat(32),
      phone_number_verified: true,
      account_status: 'active',
      iat: 1,
      nbf: 1,
      exp: 121,
      jti: 'identity-jti-1',
    })
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    )
    expect(claims).not.toHaveProperty('phone_number')
    expect(keyring.publicJwks()).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'EdDSA',
          kid: 'sso-identity-2026-07',
          kty: 'OKP',
          use: 'sig',
        }),
      ],
    })
  })

  it('rejects a wrong audience, nonce, or expired assertion', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keyring = createIdentityAssertionKeyring({
      issuer: 'https://www.yunle.fun',
      active: { kid: 'sso-identity-2026-07', privateKey },
      verificationKeys: [],
      generateJti: () => 'identity-jti-1',
    })
    const token = keyring.signIdentityAssertion({
      subject: 'user-1',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      nonce: 'n'.repeat(32),
      phoneNumberVerified: true,
      accountStatus: 'active',
      now: 1_000,
      ttlSeconds: 120,
    })

    expect(() =>
      keyring.verifyIdentityAssertion(token, {
        audience: 'drive-web',
        nonce: 'n'.repeat(32),
        now: 2_000,
      }),
    ).toThrow()
    expect(() =>
      keyring.verifyIdentityAssertion(token, {
        audience: 'cms-web',
        nonce: 'x'.repeat(32),
        now: 2_000,
      }),
    ).toThrow()
    expect(() =>
      keyring.verifyIdentityAssertion(token, {
        audience: 'cms-web',
        nonce: 'n'.repeat(32),
        now: 122_000,
        clockSkewSeconds: 0,
      }),
    ).toThrow()
  })

  it('keeps retired public keys available during rotation without retaining old private keys', () => {
    const oldPair = generateKeyPairSync('ed25519')
    const activePair = generateKeyPairSync('ed25519')
    const oldKeyring = createIdentityAssertionKeyring({
      issuer: 'https://www.yunle.fun',
      active: { kid: 'identity-old', privateKey: oldPair.privateKey },
      verificationKeys: [],
      generateJti: () => 'old-jti',
    })
    const token = oldKeyring.signIdentityAssertion({
      subject: 'user-1',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      nonce: 'n'.repeat(32),
      phoneNumberVerified: true,
      accountStatus: 'active',
      now: 1_000,
      ttlSeconds: 120,
    })
    const rotatedKeyring = createIdentityAssertionKeyring({
      issuer: 'https://www.yunle.fun',
      active: { kid: 'identity-current', privateKey: activePair.privateKey },
      verificationKeys: [{ kid: 'identity-old', publicKey: oldPair.publicKey }],
      generateJti: () => 'current-jti',
    })

    expect(
      rotatedKeyring.verifyIdentityAssertion(token, {
        audience: 'cms-web',
        nonce: 'n'.repeat(32),
        now: 2_000,
      }).jti,
    ).toBe('old-jti')
    expect(
      rotatedKeyring.publicJwks().keys.map(key => key.kid).sort(),
    ).toEqual(['identity-current', 'identity-old'])
  })
})
