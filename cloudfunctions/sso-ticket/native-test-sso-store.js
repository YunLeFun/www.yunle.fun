/** CloudBase read adapter for native synthetic SSO lease admission. */

'use strict'

const { NativeTestSsoError, validateNativeTestSsoContext } = require('./native-test-sso')

const COLLECTIONS = {
  identities: 'test_identities',
  leases: 'test_identity_leases',
}

function resultDocument(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function assertDatabaseResult(result) {
  if (!result?.code)
    return
  throw new NativeTestSsoError('test_lease_state_unavailable', 'CloudBase lease read failed')
}

async function readDocument(database, collection, id) {
  const result = await database.collection(collection).doc(id).get()
  assertDatabaseResult(result)
  return resultDocument(result)
}

function createNativeTestSsoLeaseStore(database) {
  return {
    async resolve({ leaseId, request, now, expectedUid }) {
      let binding
      await database.runTransaction(async (transaction) => {
        const lease = await readDocument(transaction, COLLECTIONS.leases, leaseId)
        const identity = lease?.identityId
          ? await readDocument(transaction, COLLECTIONS.identities, lease.identityId)
          : null
        binding = validateNativeTestSsoContext({ lease, identity }, leaseId, request, now)
        if (expectedUid !== undefined && binding.uid !== expectedUid)
          throw new NativeTestSsoError('test_lease_binding_invalid', 'SSO code UID differs from the active lease')
      })
      if (!binding)
        throw new NativeTestSsoError('test_lease_state_unavailable')
      return binding
    },
  }
}

module.exports = {
  COLLECTIONS,
  createNativeTestSsoLeaseStore,
  resultDocument,
}
