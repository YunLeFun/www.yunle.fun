import { describe, expect, it } from 'vitest'

import { assertRegistryAdminActionAllowed } from '../../cloudfunctions/sso-registry-admin/action-policy.js'

describe('sso-registry-admin action policy', () => {
  it('fails closed for direct production release actions only', () => {
    for (const action of ['publishDraft', 'rollback']) {
      expect(() => assertRegistryAdminActionAllowed(action, 'production'))
        .toThrow(expect.objectContaining({ code: 'release_approval_required' }))
      expect(() => assertRegistryAdminActionAllowed(action, 'development')).not.toThrow()
    }

    for (const action of ['saveDraft', 'validateDraft', 'getActiveEnvelope', 'getStatus'])
      expect(() => assertRegistryAdminActionAllowed(action, 'production')).not.toThrow()
  })
})
