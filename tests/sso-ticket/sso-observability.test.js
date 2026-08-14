import { describe, expect, it } from 'vitest'

import {
  buildSsoCodeConsumedAudit,
  buildSsoCodeIssuedAudit,
  buildSsoRequestRejectedAudit,
  emitSecurityAudit,
} from '../../cloudfunctions/sso-ticket/audit-log.js'

const NONCE = 'private-nonce-value-that-must-not-be-logged'
const REQUEST = {
  appId: 'drive',
  clientId: 'drive-web',
  issuer: 'https://auth.yunle.fun',
  nonce: NONCE,
  policyVersion: '2026-08-14.1',
  registrationFingerprint: 'registry-fingerprint',
  scopes: ['profile:read'],
  targetOrigin: 'https://drive.yunle.fun',
}

describe('sso audit observability contract', () => {
  it('correlates successful issue and exchange records without exposing the raw nonce', () => {
    const issued = buildSsoCodeIssuedAudit('user-1', REQUEST)
    const consumed = buildSsoCodeConsumedAudit('user-1', REQUEST, REQUEST.targetOrigin)
    const emitted = []

    emitSecurityAudit(issued, (...args) => emitted.push(args))
    emitSecurityAudit(consumed, (...args) => emitted.push(args))

    expect(issued.flowId).toMatch(/^[a-f0-9]{16}$/)
    expect(consumed.flowId).toBe(issued.flowId)
    expect(emitted).toEqual([
      ['[sso-ticket] security_event', JSON.stringify(issued)],
      ['[sso-ticket] security_event', JSON.stringify(consumed)],
    ])
    expect(JSON.stringify(emitted)).not.toContain(NONCE)
  })

  it('keeps rejected request records free of caller-supplied flow data', () => {
    const rejected = buildSsoRequestRejectedAudit('code_binding_invalid', REQUEST.targetOrigin)
    const emitted = []

    emitSecurityAudit(rejected, (...args) => emitted.push(args))

    expect(rejected).toEqual({
      event: 'sso_request_rejected',
      origin: REQUEST.targetOrigin,
      reason: 'code_binding_invalid',
    })
    expect(rejected).not.toHaveProperty('flowId')
    expect(rejected).not.toHaveProperty('nonce')
    expect(JSON.stringify(emitted)).not.toContain(NONCE)
  })
})
