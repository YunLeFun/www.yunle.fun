import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  ADMIN_APPROVAL_ACTION,
  ADMIN_APPROVAL_AUDIENCE,
  ADMIN_APPROVAL_ISSUER,
  verifyAdminApprovalProof,
} from '../../cloudfunctions/sso-registry-admin/admin-approval-runtime.js'

const NOW = 1_785_700_000_000

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
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
})
