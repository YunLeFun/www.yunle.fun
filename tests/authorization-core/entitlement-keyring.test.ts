import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createEntitlementKeyring } from '../../packages/authorization-core/src/index'

describe('entitlement keyring', () => {
  it('signs the minimum client, app, scope, device and membership claims', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keyring = createEntitlementKeyring({
      issuer: 'https://www.yunle.fun',
      active: { kid: 'entitlement-2026-07', privateKey },
      verificationKeys: [],
      generateJti: () => 'entitlement-jti-1',
    })

    const token = keyring.signMembershipEntitlement({
      subject: 'user-1',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      scopes: ['membership:read'],
      deviceJkt: 'CCMgqxK1I9oYUWdpG63s_oYwZJVW0IpGrCMvTSmK2h8',
      membership: {
        level: 'pro',
        expiresAt: 86_401_000,
      },
      now: 1_000,
      ttlSeconds: 7 * 24 * 60 * 60,
    })

    expect(keyring.verifyEntitlement(token, {
      audience: 'skykeeper-desktop',
      deviceJkt: 'CCMgqxK1I9oYUWdpG63s_oYwZJVW0IpGrCMvTSmK2h8',
      now: 2_000,
    })).toEqual({
      iss: 'https://www.yunle.fun',
      sub: 'user-1',
      aud: 'skykeeper-desktop',
      app_id: 'skykeeper',
      scope: ['membership:read'],
      cnf: {
        jkt: 'CCMgqxK1I9oYUWdpG63s_oYwZJVW0IpGrCMvTSmK2h8',
      },
      membership: {
        level: 'pro',
        expires_at: 86_401,
      },
      iat: 1,
      nbf: 1,
      exp: 604_801,
      jti: 'entitlement-jti-1',
    })
    expect(keyring.publicJwks()).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'EdDSA',
          kid: 'entitlement-2026-07',
          kty: 'OKP',
          use: 'sig',
        }),
      ],
    })
  })
})
