import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  classifySyntheticIdentity,
  isReadyFixedSyntheticIdentity,
  resolveSyntheticAction,
  SyntheticIdentityError,
  verifyLeaseCapability,
} from '../../cloudfunctions/ai-gateway/lib/test-identity.js'

const NOW_SECONDS = Math.floor(Date.UTC(2026, 6, 17) / 1000)
const KEY = crypto.randomBytes(32).toString('base64')

describe('ai-gateway lease capability verifier', () => {
  it('accepts an exact HS256 lease capability for the registered Wish action', () => {
    const claims = validClaims()
    const token = signJwt(claims)

    expect(verifyLeaseCapability(token, KEY, {
      audience: 'ai-gateway',
      nowSeconds: NOW_SECONDS,
      uid: 'test_uid_01',
      scopeId: 'wish',
      action: 'wish:audit',
      billingAppId: 'everything-generator',
    })).toMatchObject(claims)
  })

  it.each([
    ['wrong audience', { aud: 'account-api' }],
    ['expired', { exp: NOW_SECONDS - 1 }],
    ['wrong uid', { effectiveUid: 'test_uid_other' }],
    ['wrong billing app', { billingAppId: 'other-app' }],
    ['missing action', { allowedActions: ['wish:finalize'] }],
    ['registry mismatch', { registryVersion: 'old-version' }],
  ])('rejects %s', (_label, patch) => {
    const token = signJwt({ ...validClaims(), ...patch })
    expect(() => verifyLeaseCapability(token, KEY, {
      audience: 'ai-gateway',
      nowSeconds: NOW_SECONDS,
      uid: 'test_uid_01',
      scopeId: 'wish',
      action: 'wish:audit',
      billingAppId: 'everything-generator',
      registryVersion: '2026-07-17.1',
    })).toThrow(SyntheticIdentityError)
  })

  it('rejects a signature produced with another key', () => {
    const token = signJwt(validClaims(), crypto.randomBytes(32).toString('base64'))
    expect(() => verifyLeaseCapability(token, KEY, {
      audience: 'ai-gateway',
      nowSeconds: NOW_SECONDS,
    })).toThrow(SyntheticIdentityError)
  })
})

describe('ai-gateway synthetic classification and action registry', () => {
  it('distinguishes an ordinary user from a classified synthetic identity', async () => {
    await expect(classifySyntheticIdentity(queryDb([]), 'user_01')).resolves.toEqual({ synthetic: false })
    await expect(classifySyntheticIdentity(queryDb([{ _id: 'identity_01', uid: 'test_uid_01', synthetic: true }]), 'test_uid_01'))
      .resolves
      .toMatchObject({ synthetic: true, identity: { _id: 'identity_01' } })
  })

  it('fails closed when the protected classification query is unavailable', async () => {
    await expect(classifySyntheticIdentity(queryDb(null, new Error('database down')), 'user_01'))
      .rejects
      .toMatchObject({ code: 'synthetic_classification_unavailable', httpStatus: 503 })
  })

  it('derives scope and action from the server-side bizId mapping', () => {
    expect(resolveSyntheticAction('everything-generator', 'wish:req-01:audit')).toEqual({
      action: 'wish:audit',
      billingAppId: 'everything-generator',
      registryVersion: '2026-07-17.1',
      scopeId: 'wish',
      serviceAudience: 'ai-gateway',
    })
    expect(() => resolveSyntheticAction('everything-generator', 'overwatch:req-01')).toThrow(SyntheticIdentityError)
    expect(() => resolveSyntheticAction('ai-sfc', 'wish:req-01:audit')).toThrow(SyntheticIdentityError)
  })

  it('recognizes only ready fixed identities from an explicit environment', () => {
    const identity = {
      synthetic: true,
      accountKind: 'fixed',
      environment: 'production',
      status: 'ready',
    }
    expect(isReadyFixedSyntheticIdentity(identity, 'production')).toBe(true)
    expect(isReadyFixedSyntheticIdentity(identity, 'test')).toBe(false)
    expect(isReadyFixedSyntheticIdentity(identity)).toBe(false)
    expect(isReadyFixedSyntheticIdentity({ ...identity, status: 'disabled' }, 'production')).toBe(false)
    expect(isReadyFixedSyntheticIdentity({ ...identity, environment: 'unknown' }, 'production')).toBe(false)
    expect(isReadyFixedSyntheticIdentity({ ...identity, accountKind: undefined }, 'production')).toBe(false)
  })
})

function validClaims() {
  return {
    kind: 'lease-capability',
    iss: 'https://admin.yunle.fun/test-broker',
    sub: 'lease_01',
    aud: 'ai-gateway',
    leaseId: 'lease_01',
    identityId: 'identity_01',
    effectiveUid: 'test_uid_01',
    platformAppId: 'app_01',
    serviceAudience: 'ai-gateway',
    billingAppId: 'everything-generator',
    scopeIds: ['wish'],
    allowedActions: ['wish:audit', 'wish:finalize'],
    identityVersion: 7,
    registryVersion: '2026-07-17.1',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 600,
    jti: 'jti_01',
  }
}

function signJwt(payload, key = KEY) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(data).digest('base64url')
  return `${data}.${signature}`
}

function queryDb(data, error) {
  return {
    collection: () => ({
      where: () => ({
        limit: () => ({
          get: async () => {
            if (error)
              throw error
            return { data }
          },
        }),
      }),
    }),
  }
}
