import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  ADMIN_APPROVAL_ACTION,
  ADMIN_APPROVAL_AUDIENCE,
  ADMIN_APPROVAL_ISSUER,
  ADMIN_APPROVAL_TRUST_ANCHORS,
  ADMIN_DECISION_ACTION,
  ADMIN_DECISION_PERMISSION,
  loadAdminDecisionTrustAnchors,
  MANAGED_APPROVAL_ACTION,
  MANAGED_APPROVAL_TRUST_ANCHORS,
  verifyAdminApprovalProof,
  verifyAdminDecisionProof,
  verifyManagedApprovalProof,
} from '../../cloudfunctions/sso-registry-admin/admin-approval-runtime.js'

const NOW = 1_785_700_000_000

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeNonCanonicalSignature(proof) {
  const segments = proof.split('.')
  const signature = segments[2]
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const finalIndex = alphabet.indexOf(signature.at(-1))
  segments[2] = `${signature.slice(0, -1)}${alphabet[finalIndex | 1]}`
  return segments.join('.')
}

function fixture(overrides = {}) {
  const keys = generateKeyPairSync('ed25519')
  const kid = 'admin-test-key'
  const claims = {
    iss: ADMIN_APPROVAL_ISSUER,
    aud: ADMIN_APPROVAL_AUDIENCE,
    sub: '1978032370372050944',
    login: 'yunyoujun',
    role: 'owner',
    action: ADMIN_APPROVAL_ACTION,
    environment: 'production',
    draftId: 'draft:test',
    policyVersion: '2026-08-03.2',
    clientCount: 14,
    contentHash: 'a'.repeat(64),
    securityHash: 'b'.repeat(64),
    baseCommitSha: 'c'.repeat(40),
    changeReason: 'Release reviewed in Admin',
    iat: Math.floor(NOW / 1_000),
    exp: Math.floor(NOW / 1_000) + 300,
    jti: 'approval-test-id',
    ...overrides,
  }
  const header = encode({ alg: 'EdDSA', kid, typ: 'JWT' })
  const payload = encode(claims)
  const signature = sign(null, Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')
  return {
    claims,
    proof: `${header}.${payload}.${signature}`,
    options: {
      now: () => NOW,
      trustAnchors: {
        production: { [kid]: keys.publicKey.export({ format: 'jwk' }) },
      },
    },
  }
}

describe('admin Registry approval proof', () => {
  it('verifies a short-lived owner proof bound to exact release evidence', () => {
    const { claims, proof, options } = fixture()
    expect(verifyAdminApprovalProof(proof, options)).toEqual(claims)
  })

  it('rejects tampering, unexpected claims and expired proofs', () => {
    const valid = fixture()
    const tampered = `${valid.proof.slice(0, -1)}${valid.proof.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifyAdminApprovalProof(tampered, valid.options))
      .toThrow(expect.objectContaining({ code: 'admin_approval_signature_invalid' }))

    const unexpected = fixture({ unexpected: true })
    expect(() => verifyAdminApprovalProof(unexpected.proof, unexpected.options))
      .toThrow(expect.objectContaining({ code: 'admin_approval_claims_invalid' }))

    const expired = fixture({
      iat: Math.floor(NOW / 1_000) - 600,
      exp: Math.floor(NOW / 1_000) - 300,
    })
    expect(() => verifyAdminApprovalProof(expired.proof, expired.options))
      .toThrow(expect.objectContaining({ code: 'admin_approval_expired' }))
  })

  it('rejects non-canonical base64url signatures even when they decode to the same bytes', () => {
    const valid = fixture()
    const nonCanonical = makeNonCanonicalSignature(valid.proof)
    const validSignature = valid.proof.split('.')[2]
    const nonCanonicalSignature = nonCanonical.split('.')[2]

    expect(Buffer.from(nonCanonicalSignature, 'base64url'))
      .toEqual(Buffer.from(validSignature, 'base64url'))
    expect(() => verifyAdminApprovalProof(nonCanonical, valid.options))
      .toThrow(expect.objectContaining({ code: 'admin_approval_signature_invalid' }))
  })
})

describe('admin Registry decision proof v2', () => {
  function decisionFixture(overrides = {}) {
    return fixture({
      action: ADMIN_DECISION_ACTION,
      approvalId: 'approval:test',
      decision: 'approve',
      externalIdentityHash: 'd'.repeat(64),
      messageId: 'om_message_test',
      permission: ADMIN_DECISION_PERMISSION,
      role: undefined,
      ...overrides,
    })
  }

  it('verifies exact short-lived decision evidence without accepting the legacy schema', () => {
    const { claims, proof, options } = decisionFixture()
    expect(verifyAdminDecisionProof(proof, options)).toEqual(claims)
    expect(() => verifyAdminApprovalProof(proof, options))
      .toThrow(expect.objectContaining({ code: 'admin_approval_claims_invalid' }))
  })

  it.each(['approve', 'reject', 'email_fallback'])('accepts the %s decision', (decision) => {
    const { proof, options } = decisionFixture({ decision })
    expect(verifyAdminDecisionProof(proof, options).decision).toBe(decision)
  })

  it('fails closed for unexpected fields, permission, identity hash and message id', () => {
    const unexpected = decisionFixture({ unexpected: true })
    expect(() => verifyAdminDecisionProof(unexpected.proof, unexpected.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_claims_invalid' }))

    const permission = decisionFixture({ permission: 'admin:write' })
    expect(() => verifyAdminDecisionProof(permission.proof, permission.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_claims_invalid' }))

    const identity = decisionFixture({ externalIdentityHash: 'not-a-hash' })
    expect(() => verifyAdminDecisionProof(identity.proof, identity.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_identity_invalid' }))

    const message = decisionFixture({ messageId: '' })
    expect(() => verifyAdminDecisionProof(message.proof, message.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_message_invalid' }))
  })

  it('rejects tampering, an untrusted key and expired evidence', () => {
    const valid = decisionFixture()
    const tampered = `${valid.proof.slice(0, -1)}${valid.proof.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifyAdminDecisionProof(tampered, valid.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_signature_invalid' }))

    expect(() => verifyAdminDecisionProof(valid.proof, {
      ...valid.options,
      trustAnchors: { production: {} },
    })).toThrow(expect.objectContaining({ code: 'admin_decision_key_untrusted' }))

    const expired = decisionFixture({
      iat: Math.floor(NOW / 1_000) - 600,
      exp: Math.floor(NOW / 1_000) - 300,
    })
    expect(() => verifyAdminDecisionProof(expired.proof, expired.options))
      .toThrow(expect.objectContaining({ code: 'admin_decision_expired' }))
  })

  it('loads only an explicit Ed25519 production key ring', () => {
    const keys = generateKeyPairSync('ed25519')
    const publicJwk = keys.publicKey.export({ format: 'jwk' })
    expect(loadAdminDecisionTrustAnchors({
      SSO_REGISTRY_ADMIN_DECISION_PUBLIC_KEYS: JSON.stringify({
        'decision-key': publicJwk,
      }),
    })).toEqual({
      production: {
        'decision-key': publicJwk,
      },
    })
    expect(() => loadAdminDecisionTrustAnchors({
      SSO_REGISTRY_ADMIN_DECISION_PUBLIC_KEYS: '{}',
    })).toThrow(/at least one key/)
    expect(() => loadAdminDecisionTrustAnchors({
      SSO_REGISTRY_ADMIN_DECISION_PUBLIC_KEYS: JSON.stringify({
        'decision-key': keys.privateKey.export({ format: 'jwk' }),
      }),
    })).toThrow(/invalid Ed25519 key/)
  })
})

describe('managed Registry approval proof', () => {
  it('uses a trust anchor that cannot sign owner approvals', () => {
    expect(Object.keys(MANAGED_APPROVAL_TRUST_ANCHORS.production)).toEqual([
      'admin-registry-managed-20260812',
    ])
    expect(ADMIN_APPROVAL_TRUST_ANCHORS.production['admin-registry-managed-20260812']).toBeUndefined()
    expect(MANAGED_APPROVAL_TRUST_ANCHORS.production['admin-registry-approval-20260809']).toBeUndefined()
  })

  it('verifies short-lived machine evidence for exact managed clients', () => {
    const managedClients = [{
      clientId: 'fan-web',
      appId: 'fan',
      origin: 'https://fan.yunle.fun',
      projectId: 'pages-fan',
      repository: 'YunLeFun/fan',
    }]
    const { proof, options } = fixture({
      action: MANAGED_APPROVAL_ACTION,
      sub: 'policy:managed-yunlefun',
      managedClients,
      login: undefined,
      role: undefined,
    })

    expect(verifyManagedApprovalProof(proof, options)).toMatchObject({
      action: MANAGED_APPROVAL_ACTION,
      sub: 'policy:managed-yunlefun',
      managedClients,
    })
  })

  it('rejects wildcard evidence and unexpected machine subjects', () => {
    const wildcard = fixture({
      action: MANAGED_APPROVAL_ACTION,
      sub: 'policy:managed-yunlefun',
      managedClients: [{
        clientId: 'fan-web',
        appId: 'fan',
        origin: 'https://*.yunle.fun',
        projectId: 'pages-fan',
        repository: 'YunLeFun/fan',
      }],
      login: undefined,
      role: undefined,
    })
    expect(() => verifyManagedApprovalProof(wildcard.proof, wildcard.options))
      .toThrow(expect.objectContaining({ code: 'managed_approval_origin_invalid' }))

    const subject = fixture({
      action: MANAGED_APPROVAL_ACTION,
      sub: 'admin:yunyoujun',
      managedClients: [{
        clientId: 'fan-web',
        appId: 'fan',
        origin: 'https://fan.yunle.fun',
        projectId: 'pages-fan',
        repository: 'YunLeFun/fan',
      }],
      login: undefined,
      role: undefined,
    })
    expect(() => verifyManagedApprovalProof(subject.proof, subject.options))
      .toThrow(expect.objectContaining({ code: 'managed_approval_claims_invalid' }))
  })
})
