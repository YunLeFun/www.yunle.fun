import { describe, expect, it, vi } from 'vitest'

import {
  resolveFixedTestIdentityAdmission,
} from '../../cloudfunctions/sso-ticket/fixed-test-identity-admission.js'

function databaseWith(rows) {
  const get = vi.fn(async () => ({ data: rows }))
  const limit = vi.fn(() => ({ get }))
  const where = vi.fn(() => ({ limit }))
  const collection = vi.fn(() => ({ where }))
  return { database: { collection }, spies: { collection, get, limit, where } }
}

function fixedIdentity(overrides = {}) {
  return {
    _id: 'testid_production-standard',
    uid: 'uid_fixed_standard',
    synthetic: true,
    accountKind: 'fixed',
    environment: 'production',
    status: 'ready',
    access: {
      mode: 'shared-password',
      username: 'ylf_prod_standard',
      credentialConfigured: true,
      rotatedAt: 1,
    },
    ...overrides,
  }
}

describe('fixed test account SSO admission', () => {
  it('admits the authenticated uid only when it is a ready fixed account in the current environment', async () => {
    const { database, spies } = databaseWith([fixedIdentity()])

    await expect(resolveFixedTestIdentityAdmission(database, {
      issuerEnvironment: 'production',
      uid: 'uid_fixed_standard',
    })).resolves.toEqual({ phoneNumberVerified: true })

    expect(spies.collection).toHaveBeenCalledWith('test_identities')
    expect(spies.where).toHaveBeenCalledWith({ uid: 'uid_fixed_standard' })
    expect(spies.limit).toHaveBeenCalledWith(2)
  })

  it.each([
    ['disabled account', { status: 'disabled' }],
    ['native-session legacy account', { access: { mode: 'native-sso' } }],
    ['unconfigured credential', { access: { ...fixedIdentity().access, credentialConfigured: false } }],
    ['non-synthetic account', { synthetic: false }],
    ['wrong environment', { environment: 'test' }],
    ['wrong subject', { uid: 'uid_someone_else' }],
  ])('does not admit a %s', async (_label, overrides) => {
    const { database } = databaseWith([fixedIdentity(overrides)])

    await expect(resolveFixedTestIdentityAdmission(database, {
      issuerEnvironment: 'production',
      uid: 'uid_fixed_standard',
    })).resolves.toBeNull()
  })

  it('maps the development issuer to the test account environment', async () => {
    const { database } = databaseWith([fixedIdentity({ environment: 'test' })])

    await expect(resolveFixedTestIdentityAdmission(database, {
      issuerEnvironment: 'development',
      uid: 'uid_fixed_standard',
    })).resolves.toEqual({ phoneNumberVerified: true })
  })

  it('fails closed on ambiguous or unavailable protected identity state', async () => {
    const ambiguous = databaseWith([fixedIdentity(), fixedIdentity({ _id: 'duplicate' })])
    await expect(resolveFixedTestIdentityAdmission(ambiguous.database, {
      issuerEnvironment: 'production',
      uid: 'uid_fixed_standard',
    })).rejects.toMatchObject({ reason: 'identity_invalid' })

    const unavailable = databaseWith([])
    unavailable.spies.get.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveFixedTestIdentityAdmission(unavailable.database, {
      issuerEnvironment: 'production',
      uid: 'uid_fixed_standard',
    })).rejects.toMatchObject({ reason: 'identity_unavailable' })
  })
})
