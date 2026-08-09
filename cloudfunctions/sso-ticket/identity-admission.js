/** Trusted CloudBase profile admission for Web SSO identity assertions. */

'use strict'

class IdentityAdmissionError extends Error {
  constructor(reason, message = reason) {
    super(message)
    this.name = 'IdentityAdmissionError'
    this.reason = reason
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function profileMatchesSubject(profile, uid) {
  const subjects = [
    profile.uid,
    profile.sub,
    profile.id,
    profile.customUserId,
  ].map(nonEmptyString).filter(Boolean)
  return subjects.includes(uid)
}

function hasTrustedPhoneCredential(profile) {
  return !!(
    nonEmptyString(profile.phone_number)
    || nonEmptyString(profile.phoneNumber)
    || nonEmptyString(profile.phone)
  )
}

async function assertVerifiedPhoneForUid(auth, uid) {
  let result
  try {
    result = await auth.getEndUserInfo(uid)
  }
  catch {
    throw new IdentityAdmissionError('identity_unavailable')
  }
  const profile = isRecord(result?.userInfo) ? result.userInfo : null
  if (!profile || !profileMatchesSubject(profile, uid))
    throw new IdentityAdmissionError('identity_invalid')
  if (!hasTrustedPhoneCredential(profile))
    throw new IdentityAdmissionError('phone_verification_required')
  return { phoneNumberVerified: true }
}

async function resolvePhoneVerificationAdmission({ auth, uid, resolveFixedTestIdentity }) {
  try {
    return await assertVerifiedPhoneForUid(auth, uid)
  }
  catch (error) {
    if (!(error instanceof IdentityAdmissionError) || error.reason !== 'phone_verification_required')
      throw error
  }

  const fixedTestAdmission = typeof resolveFixedTestIdentity === 'function'
    ? await resolveFixedTestIdentity({ uid })
    : null
  if (fixedTestAdmission?.phoneNumberVerified !== true)
    throw new IdentityAdmissionError('phone_verification_required')
  return { phoneNumberVerified: true }
}

module.exports = {
  IdentityAdmissionError,
  assertVerifiedPhoneForUid,
  hasTrustedPhoneCredential,
  profileMatchesSubject,
  resolvePhoneVerificationAdmission,
}
