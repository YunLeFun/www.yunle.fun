import { describe, expect, it } from 'vitest'
import { isTestAccountFeatureRestriction } from '../app/utils/account-feature-restriction'

describe('test account feature restrictions', () => {
  it('accepts only an explicit business denial, preserving genuine service failures', () => {
    expect(isTestAccountFeatureRestriction({ ok: false, code: 'synthetic_action_forbidden' })).toBe(true)
    for (const value of [null, new Error('FUNCTIONS_INVOCATION_FAILED'), { code: 'FUNCTIONS_INVOCATION_FAILED' }, { ok: false, code: 'synthetic_classification_unavailable' }, { username: 'ylf_prod_standard' }, { ok: true, code: 'synthetic_action_forbidden' }]) {
      expect(isTestAccountFeatureRestriction(value)).toBe(false)
    }
  })
})
