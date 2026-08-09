/** Protected fixed-test-account fallback for Web SSO phone admission. */

'use strict'

const { IdentityAdmissionError } = require('./identity-admission')

function expectedAccountEnvironment(issuerEnvironment) {
  return issuerEnvironment === 'development' ? 'test' : 'production'
}

function isReadyFixedIdentity(identity, input) {
  return identity
    && identity.uid === input.uid
    && identity.synthetic === true
    && identity.accountKind === 'fixed'
    && identity.environment === expectedAccountEnvironment(input.issuerEnvironment)
    && identity.status === 'ready'
    && identity.access?.mode === 'shared-password'
    && identity.access.credentialConfigured === true
}

async function resolveFixedTestIdentityAdmission(database, input) {
  let response
  try {
    response = await database.collection('test_identities')
      .where({ uid: input.uid })
      .limit(2)
      .get()
  }
  catch {
    throw new IdentityAdmissionError('identity_unavailable')
  }

  const identities = Array.isArray(response?.data) ? response.data : []
  if (identities.length > 1)
    throw new IdentityAdmissionError('identity_invalid')
  return isReadyFixedIdentity(identities[0], input)
    ? { phoneNumberVerified: true }
    : null
}

module.exports = {
  expectedAccountEnvironment,
  isReadyFixedIdentity,
  resolveFixedTestIdentityAdmission,
}
