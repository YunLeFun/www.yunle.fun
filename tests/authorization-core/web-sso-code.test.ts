import { describe, expect, it } from 'vitest'

import {
  createWebSsoCodeMachine,
} from '../../packages/authorization-core/src/index'

const CODE = 'A'.repeat(43)
const VERIFIER = 'V'.repeat(43)
const CHALLENGE = 'S0-WMMHEuuumkDoJt044nSxveejcVm4-B681Rl_3cJ4'

describe('web SSO authorization code machine', () => {
  it('issues a hash-only code record and consumes it against every binding', () => {
    const codes = createWebSsoCodeMachine({ generateCode: () => CODE })
    const issued = codes.issue({
      subject: 'user-1',
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.fun',
      redirectUri: 'https://cms.yunle.fun/',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      policyVersion: '2026-07-23.1',
      registrationFingerprint: 'f'.repeat(64),
      now: 1_000,
      ttlSeconds: 60,
    })

    expect(issued.code).toBe(CODE)
    expect(issued.record).toMatchObject({
      status: 'pending',
      codeHash: '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a',
      clientId: 'cms-web',
      appId: 'cms',
      expiresAt: 61_000,
    })
    expect(issued.record).not.toHaveProperty('code')

    expect(codes.consume(issued.record, {
      code: CODE,
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.fun',
      redirectUri: 'https://cms.yunle.fun/',
      nonce: 'n'.repeat(32),
      codeVerifier: VERIFIER,
      policyVersion: '2026-07-23.1',
      registrationFingerprint: 'f'.repeat(64),
      now: 2_000,
    })).toMatchObject({
      subject: 'user-1',
      next: {
        status: 'consumed',
        consumedAt: 2_000,
      },
    })
  })

  it('invalidates pending codes when the registered security policy changes', () => {
    const codes = createWebSsoCodeMachine({ generateCode: () => CODE })
    const issued = codes.issue({
      subject: 'user-1',
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.fun',
      redirectUri: 'https://cms.yunle.fun/',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      policyVersion: '2026-07-23.1',
      registrationFingerprint: 'f'.repeat(64),
      now: 1_000,
      ttlSeconds: 60,
    })

    expect(() => codes.consume(issued.record, {
      code: CODE,
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.fun',
      redirectUri: 'https://cms.yunle.fun/',
      nonce: 'n'.repeat(32),
      codeVerifier: VERIFIER,
      policyVersion: '2026-07-23.2',
      registrationFingerprint: '0'.repeat(64),
      now: 2_000,
    })).toThrowError(expect.objectContaining({ code: 'client_binding_invalid' }))
  })
})
