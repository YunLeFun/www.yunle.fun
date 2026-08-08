import { describe, expect, it, vi } from 'vitest'

import { createNativeTestSsoLeaseStore } from '../../cloudfunctions/sso-ticket/native-test-sso-store.js'
import {
  issueSsoCodeForTestLease,
  NativeTestSsoError,
  validateNativeTestSsoContext,
} from '../../cloudfunctions/sso-ticket/native-test-sso.js'

const NOW = Date.UTC(2026, 7, 5, 3, 0, 0)
const TOKEN = 'native-sso-service-token-with-at-least-32-bytes'
const request = {
  mode: 'redirect',
  clientId: 'cms-web',
  appId: 'cms',
  issuer: 'https://www.yunle.fun',
  scopes: ['identity:bootstrap'],
  targetOrigin: 'https://cms.yunle.fun',
  returnUrl: 'https://cms.yunle.fun/',
  nonce: 'n'.repeat(32),
  codeChallenge: 'c'.repeat(43),
  policyVersion: 'registry-v1',
  registrationFingerprint: 'f'.repeat(64),
}
const aiRequest = {
  ...request,
  clientId: 'ai-sfc-web',
  appId: 'ai-sfc',
  targetOrigin: 'https://ai-sfc.yunle.fun',
  returnUrl: 'https://ai-sfc.yunle.fun/',
}
const lease = {
  _id: 'lease_native_01',
  identityId: 'identity_native_01',
  effectiveUid: 'uid_native_test',
  target: {
    platformAppId: 'yunjian',
    origin: 'https://cms.yunle.fun',
    serviceAudience: 'sso-ticket',
    scopeIds: ['native-sso'],
    allowedActions: ['identity:bootstrap'],
  },
  status: 'active',
  expiresAt: NOW + 900_000,
  sessionNotAfter: NOW + 900_000,
}
const aiLease = {
  ...lease,
  target: {
    ...lease.target,
    platformAppId: 'ai-sfc',
    origin: 'https://ai-sfc.yunle.fun',
  },
}
const identity = {
  _id: 'identity_native_01',
  uid: 'uid_native_test',
  source: 'managed',
  synthetic: true,
  status: 'leased',
  activeLeaseId: lease._id,
  activeLeaseExpiresAt: lease.expiresAt,
  authProfile: {
    publicAlias: 'native-sso-smoke@yunlefun',
    virtualPhone: '+86 000 0000 0001',
    verificationMode: 'synthetic-otp',
    virtualPhoneBound: true,
  },
}

describe('native test SSO lease admission', () => {
  it('loads the lease and identity together from protected CloudBase collections', async () => {
    const database = new NativeLeaseMemoryDb({
      test_identity_leases: { [lease._id]: lease },
      test_identities: { [identity._id]: identity },
    })
    const store = createNativeTestSsoLeaseStore(database)

    await expect(store.resolve({ leaseId: lease._id, request, now: NOW })).resolves.toEqual({
      uid: identity.uid,
      expiresAt: lease.expiresAt,
      phoneNumberVerified: true,
    })
  })

  it('issues a standard PKCE code using only the lease-derived UID', async () => {
    const issueCode = vi.fn(async input => ({ code: 's'.repeat(43), expiresAt: NOW + 60_000, input }))
    const result = await issueSsoCodeForTestLease({
      action: 'issueSsoCodeForTestLease',
      serviceToken: TOKEN,
      leaseId: lease._id,
      ...request,
    }, {
      expectedToken: TOKEN,
      now: () => NOW,
      validateRequest: () => request,
      resolveLease: async () => validateNativeTestSsoContext({ lease, identity }, lease._id, request, NOW),
      consumeRateLimit: async () => undefined,
      issueCode,
    })

    expect(result).toEqual({ ok: true, code: 's'.repeat(43), expiresAt: NOW + 60_000 })
    expect(issueCode).toHaveBeenCalledWith(expect.objectContaining({
      uid: identity.uid,
      testLeaseId: lease._id,
      clientId: 'cms-web',
    }))
  })

  it('rejects caller-selected subjects, reused service credentials, and wrong targets', async () => {
    const deps = {
      expectedToken: TOKEN,
      now: () => NOW,
      validateRequest: () => request,
      resolveLease: async () => validateNativeTestSsoContext({ lease, identity }, lease._id, request, NOW),
      consumeRateLimit: async () => undefined,
      issueCode: async () => ({ code: 's'.repeat(43), expiresAt: NOW + 60_000 }),
    }
    await expect(issueSsoCodeForTestLease({
      serviceToken: 'wrong-service-token-that-is-still-long-enough',
      leaseId: lease._id,
    }, deps)).rejects.toMatchObject({ reason: 'forbidden' })
    await expect(issueSsoCodeForTestLease({
      serviceToken: TOKEN,
      leaseId: lease._id,
      uid: 'attacker-selected',
    }, deps)).rejects.toMatchObject({ reason: 'subject_not_allowed' })
    expect(() => validateNativeTestSsoContext({
      lease: { ...lease, target: { ...lease.target, platformAppId: 'other-app' } },
      identity,
    }, lease._id, request, NOW)).toThrowError(NativeTestSsoError)
  })

  it('revalidates the exact UID and active lease at public code exchange time', () => {
    expect(validateNativeTestSsoContext({ lease, identity }, lease._id, request, NOW)).toEqual({
      uid: identity.uid,
      expiresAt: lease.expiresAt,
      phoneNumberVerified: true,
    })
    expect(validateNativeTestSsoContext({ lease: aiLease, identity }, lease._id, aiRequest, NOW)).toEqual({
      uid: identity.uid,
      expiresAt: lease.expiresAt,
      phoneNumberVerified: true,
    })
    expect(() => validateNativeTestSsoContext({ lease, identity }, lease._id, aiRequest, NOW))
      .toThrowError(expect.objectContaining({ reason: 'test_lease_binding_invalid' }))
    expect(() => validateNativeTestSsoContext({ lease: aiLease, identity }, lease._id, request, NOW))
      .toThrowError(expect.objectContaining({ reason: 'test_lease_binding_invalid' }))
    expect(() => validateNativeTestSsoContext({
      lease: { ...lease, status: 'revoking' },
      identity,
    }, lease._id, request, NOW)).toThrowError(expect.objectContaining({ reason: 'test_lease_inactive' }))
    expect(() => validateNativeTestSsoContext({ lease, identity }, lease._id, {
      ...request,
      targetOrigin: 'https://evil.example',
    }, NOW)).toThrowError(expect.objectContaining({ reason: 'test_lease_binding_invalid' }))
    expect(() => validateNativeTestSsoContext({ lease, identity }, lease._id, {
      ...aiRequest,
      returnUrl: 'https://cms.yunle.fun/',
    }, NOW)).toThrowError(expect.objectContaining({ reason: 'test_lease_binding_invalid' }))
    expect(() => validateNativeTestSsoContext({ lease: aiLease, identity }, lease._id, {
      ...aiRequest,
      targetOrigin: 'https://ai-sfc.yunle.fun/path',
    }, NOW)).toThrowError(expect.objectContaining({ reason: 'test_lease_binding_invalid' }))
    expect(() => validateNativeTestSsoContext({
      lease,
      identity: {
        ...identity,
        authProfile: { ...identity.authProfile, virtualPhoneBound: false },
      },
    }, lease._id, request, NOW)).toThrowError(expect.objectContaining({ reason: 'test_identity_binding_invalid' }))
  })
})

class NativeLeaseMemoryDb {
  constructor(documents) {
    this.documents = structuredClone(documents)
  }

  collection(name) {
    return this.reference(name)
  }

  reference(name) {
    return {
      doc: id => ({
        get: async () => ({ data: this.documents[name]?.[id] ? [structuredClone(this.documents[name][id])] : [] }),
      }),
    }
  }

  async runTransaction(callback) {
    return callback({ collection: name => this.reference(name) })
  }
}
