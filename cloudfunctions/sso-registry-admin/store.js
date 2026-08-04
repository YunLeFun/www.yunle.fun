/** CloudBase NoSQL adapter for the SSO Client Registry control plane. */

'use strict'

const COLLECTIONS = Object.freeze({
  drafts: 'sso_registry_drafts',
  snapshots: 'sso_registry_snapshots',
  state: 'sso_registry_state',
  audit: 'sso_registry_audit_logs',
})

const SSO_REGISTRY_COLLECTION_MANIFESTS = Object.freeze([
  {
    collection: COLLECTIONS.drafts,
    access: 'ADMINONLY',
    indexes: [{
      name: 'environment_status_updated',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'updatedAt', order: 'desc' },
      ],
    }],
  },
  {
    collection: COLLECTIONS.snapshots,
    access: 'ADMINONLY',
    indexes: [{
      name: 'environment_sequence',
      unique: true,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'sequence', order: 'desc' },
      ],
    }, {
      name: 'environment_policy_published',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'policyVersion', order: 'asc' },
        { field: 'publishedAt', order: 'desc' },
      ],
    }, {
      name: 'environment_content_hash',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'contentHash', order: 'asc' },
      ],
    }],
  },
  {
    collection: COLLECTIONS.state,
    access: 'ADMINONLY',
    indexes: [],
  },
  {
    collection: COLLECTIONS.audit,
    access: 'ADMINONLY',
    indexes: [{
      name: 'environment_created',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }, {
      name: 'environment_operator_created',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'operator', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }],
  },
])

function row(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function withoutId(value) {
  if (!value || typeof value !== 'object')
    return value
  const { _id, ...document } = value
  return document
}

function assertDatabaseResult(result, requireUpdated = false) {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Registry database operation returned an invalid result')
  if (result.code !== undefined && result.code !== 0 && result.code !== '0') {
    const error = new Error(typeof result.message === 'string' ? result.message : 'Registry database operation failed')
    error.code = result.code
    throw error
  }
  const updated = result.updated ?? result.modifiedCount
  if (requireUpdated && updated !== undefined && (!Number.isSafeInteger(Number(updated)) || Number(updated) < 1))
    throw new Error('Registry database update modified no documents')
}

function createRegistryStore(database, source = database) {
  if (!database || typeof database.runTransaction !== 'function' || !source?.collection)
    throw new TypeError('CloudBase database is required')

  function ref(collection, id) {
    return source.collection(collection).doc(id)
  }

  return {
    async getDraft(id) {
      return withoutId(row(await ref(COLLECTIONS.drafts, id).get()))
    },
    async putDraft(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.drafts, id).set(withoutId(document)))
    },
    async updateDraft(id, fields) {
      assertDatabaseResult(await ref(COLLECTIONS.drafts, id).update(withoutId(fields)), true)
    },
    async getSnapshot(id) {
      return withoutId(row(await ref(COLLECTIONS.snapshots, id).get()))
    },
    async putSnapshot(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.snapshots, id).set(withoutId(document)))
    },
    async getState(environment) {
      return withoutId(row(await ref(COLLECTIONS.state, environment).get()))
    },
    async putState(environment, document) {
      assertDatabaseResult(await ref(COLLECTIONS.state, environment).set(withoutId(document)))
    },
    async putAudit(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.audit, id).set(withoutId(document)))
    },
    transaction(operation) {
      return database.runTransaction(transaction => operation(createRegistryStore(database, transaction)))
    },
  }
}

module.exports = {
  SSO_REGISTRY_COLLECTION_MANIFESTS,
  createRegistryStore,
}
