import { describe, expect, it, vi } from 'vitest'

import {
  assertVerifiedPhoneForUid,
  IdentityAdmissionError,
  resolvePhoneVerificationAdmission,
} from '../../cloudfunctions/sso-ticket/identity-admission.js'

describe('sso-ticket verified-phone admission', () => {
  it('derives a boolean admission fact from the trusted top-level CloudBase profile', async () => {
    const getEndUserInfo = vi.fn(async () => ({
      userInfo: {
        uid: 'user-1',
        phone_number: '+86 13800138000',
        user_metadata: { phone_number_verified: false },
      },
    }))

    await expect(assertVerifiedPhoneForUid({ getEndUserInfo }, 'user-1')).resolves.toEqual({
      phoneNumberVerified: true,
    })
    expect(getEndUserInfo).toHaveBeenCalledWith('user-1')
  })

  it('does not trust user metadata or a profile belonging to a different subject', async () => {
    await expect(assertVerifiedPhoneForUid({
      getEndUserInfo: async () => ({
        userInfo: {
          uid: 'user-1',
          user_metadata: {
            phone_number: '+86 13800138000',
            phone_number_verified: true,
          },
        },
      }),
    }, 'user-1')).rejects.toMatchObject({
      reason: 'phone_verification_required',
    })

    await expect(assertVerifiedPhoneForUid({
      getEndUserInfo: async () => ({
        userInfo: {
          uid: 'user-2',
          phone_number: '+86 13800138000',
        },
      }),
    }, 'user-1')).rejects.toBeInstanceOf(IdentityAdmissionError)
  })

  it('fails closed when CloudBase user lookup is unavailable', async () => {
    await expect(assertVerifiedPhoneForUid({
      getEndUserInfo: async () => {
        throw new Error('upstream unavailable')
      },
    }, 'user-1')).rejects.toMatchObject({
      reason: 'identity_unavailable',
    })
  })

  it('accepts only an explicit verified fact from a protected test lease binding', async () => {
    const auth = { getEndUserInfo: vi.fn() }
    await expect(resolvePhoneVerificationAdmission({
      auth,
      uid: 'uid_native_test',
      testLeaseBinding: { phoneNumberVerified: true },
    })).resolves.toEqual({ phoneNumberVerified: true })
    expect(auth.getEndUserInfo).not.toHaveBeenCalled()

    await expect(resolvePhoneVerificationAdmission({
      auth,
      uid: 'uid_native_test',
      testLeaseBinding: {},
    })).rejects.toMatchObject({ reason: 'phone_verification_required' })
  })
})
