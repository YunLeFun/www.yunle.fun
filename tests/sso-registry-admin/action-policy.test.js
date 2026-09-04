import { describe, expect, it } from 'vitest'

import { assertRegistryAdminActionAllowed } from '../../cloudfunctions/sso-registry-admin/action-policy.js'

describe('sso-registry-admin action policy', () => {
  it('fails closed for direct production release actions only', () => {
    for (const action of ['publishDraft', 'rollback']) {
      expect(() => assertRegistryAdminActionAllowed(action, 'production'))
        .toThrow(expect.objectContaining({ code: 'release_approval_required' }))
      expect(() => assertRegistryAdminActionAllowed(action, 'development')).not.toThrow()
    }

    for (const action of ['saveDraft', 'rebaseDraft', 'validateDraft', 'getActiveEnvelope', 'getStatus'])
      expect(() => assertRegistryAdminActionAllowed(action, 'production')).not.toThrow()
  })

  it('requires a dedicated token for CI progress and deployment actions', () => {
    for (const action of ['getReleaseIntent', 'recordCiProgress', 'recordDeploymentResult']) {
      expect(() => assertRegistryAdminActionAllowed(action, 'development', {
        ciToken: 'wrong-token-with-sufficient-length-123',
        expectedCiToken: 'expected-token-with-sufficient-length',
      })).toThrow(expect.objectContaining({ code: 'ci_identity_required' }))
      expect(() => assertRegistryAdminActionAllowed(action, 'development', {
        ciToken: 'expected-token-with-sufficient-length',
        expectedCiToken: 'expected-token-with-sufficient-length',
      })).not.toThrow()
    }
  })

  it('allows decision consumption only for the exact timer envelope', () => {
    expect(() => assertRegistryAdminActionAllowed(
      'processPendingAdminApprovalDecisions',
      'production',
    )).toThrow(expect.objectContaining({ code: 'timer_identity_required' }))
    expect(() => assertRegistryAdminActionAllowed(
      'processPendingAdminApprovalDecisions',
      'production',
      { timerTrigger: true },
    )).not.toThrow()
  })
})
