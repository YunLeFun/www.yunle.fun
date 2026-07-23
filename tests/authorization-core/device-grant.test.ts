import { describe, expect, it } from 'vitest'

import { createDeviceGrantMachine } from '../../packages/authorization-core/src/index'

const DEVICE_CODE = 'D'.repeat(43)
const DEVICE_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'W_c2agC82FxzPDetWaxqeUvBZhXbi0h8MNHycrV22kw',
  y: 'yVW_1OQZg42swvmkz8VaA-Mydb4On6i8UoMuShvzPI8',
} as const
const DEVICE_JKT = 'CCMgqxK1I9oYUWdpG63s_oYwZJVW0IpGrCMvTSmK2h8'

describe('device authorization grant machine', () => {
  it('binds approval and one-time consumption to the registered client and device key', () => {
    const grants = createDeviceGrantMachine({
      generateDeviceCode: () => DEVICE_CODE,
      generateUserCode: () => 'ABCD-EFGH',
    })
    const started = grants.start({
      authorization: {
        issuer: 'https://www.yunle.fun',
        clientId: 'skykeeper-desktop',
        appId: 'skykeeper',
        displayName: 'Skykeeper',
        adapter: 'device',
        consent: 'explicit',
        scopes: ['membership:read'],
        policyVersion: '2026-07-23.1',
        registrationFingerprint: 'f'.repeat(64),
      },
      devicePublicJwk: DEVICE_JWK,
      deviceName: 'Skykeeper · Windows',
      now: 1_000,
      ttlSeconds: 600,
    })

    expect(started).toMatchObject({
      deviceCode: DEVICE_CODE,
      userCode: 'ABCD-EFGH',
      record: {
        status: 'pending',
        clientId: 'skykeeper-desktop',
        appId: 'skykeeper',
        scopes: ['membership:read'],
        deviceId: DEVICE_JKT,
        deviceJkt: DEVICE_JKT,
        expiresAt: 601_000,
      },
    })
    expect(started.record).not.toHaveProperty('deviceCode')
    expect(started.record).not.toHaveProperty('userCode')

    const approved = grants.approve(started.record, {
      subject: 'user-1',
      now: 2_000,
    })
    const consumed = grants.consume(approved, {
      deviceCode: DEVICE_CODE,
      proofJkt: DEVICE_JKT,
      now: 3_000,
    })

    expect(consumed).toMatchObject({
      next: {
        status: 'consumed',
        consumedAt: 3_000,
      },
      grant: {
        subject: 'user-1',
        issuer: 'https://www.yunle.fun',
        clientId: 'skykeeper-desktop',
        appId: 'skykeeper',
        scopes: ['membership:read'],
        deviceId: DEVICE_JKT,
        deviceJkt: DEVICE_JKT,
        authorizedAt: 2_000,
        registrationFingerprint: 'f'.repeat(64),
      },
    })
  })
})
