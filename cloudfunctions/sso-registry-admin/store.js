/** CloudBase NoSQL adapter for the SSO Client Registry control plane. */

'use strict'

const COLLECTIONS = Object.freeze({
  approvals: 'sso_registry_publish_approvals',
  drafts: 'sso_registry_drafts',
  intents: 'sso_registry_release_intents',
  outbox: 'sso_registry_release_outbox',
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
  {
    collection: COLLECTIONS.approvals,
    access: 'ADMINONLY',
    indexes: [{
      name: 'environment_status_expires',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'expiresAt', order: 'asc' },
      ],
    }, {
      name: 'draft_created',
      unique: false,
      fields: [
        { field: 'draftId', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }, {
      name: 'approver_created',
      unique: false,
      fields: [
        { field: 'approverUid', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }],
  },
  {
    collection: COLLECTIONS.intents,
    access: 'ADMINONLY',
    indexes: [{
      name: 'environment_status_updated',
      unique: false,
      fields: [
        { field: 'environment', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'updatedAt', order: 'desc' },
      ],
    }, {
      name: 'snapshot_created',
      unique: false,
      fields: [
        { field: 'snapshotId', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }],
  },
  {
    collection: COLLECTIONS.outbox,
    access: 'ADMINONLY',
    indexes: [{
      name: 'status_next_attempt',
      unique: false,
      fields: [
        { field: 'status', order: 'asc' },
        { field: 'nextAttemptAt', order: 'asc' },
      ],
    }, {
      name: 'status_lease_expiry',
      unique: false,
      fields: [
        { field: 'status', order: 'asc' },
        { field: 'leaseExpiresAt', order: 'asc' },
      ],
    }],
  },
])

function row(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function rows(result) {
  return Array.isArray(result?.data) ? result.data : []
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
    async getApproval(id) {
      return withoutId(row(await ref(COLLECTIONS.approvals, id).get()))
    },
    async putApproval(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.approvals, id).set(withoutId(document)))
    },
    async updateApproval(id, fields) {
      assertDatabaseResult(await ref(COLLECTIONS.approvals, id).update(withoutId(fields)), true)
    },
    async findPendingApprovalByDraft(environment, draftId) {
      const result = await source.collection(COLLECTIONS.approvals)
        .where({
          environment,
          draftId,
          status: database.command.in(['delivery_pending', 'pending']),
        })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
      const found = rows(result)[0]
      return found ? { approvalId: found._id, ...withoutId(found) } : null
    },
    async getReleaseIntent(id) {
      return withoutId(row(await ref(COLLECTIONS.intents, id).get()))
    },
    async putReleaseIntent(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.intents, id).set(withoutId(document)))
    },
    async updateReleaseIntent(id, fields) {
      assertDatabaseResult(await ref(COLLECTIONS.intents, id).update(withoutId(fields)), true)
    },
    async getOutbox(id) {
      return withoutId(row(await ref(COLLECTIONS.outbox, id).get()))
    },
    async putOutbox(id, document) {
      assertDatabaseResult(await ref(COLLECTIONS.outbox, id).set(withoutId(document)))
    },
    async updateOutbox(id, fields) {
      assertDatabaseResult(await ref(COLLECTIONS.outbox, id).update(withoutId(fields)), true)
    },
    async listReadyOutbox(timestamp, limit = 10) {
      const result = await source.collection(COLLECTIONS.outbox)
        .where({
          status: database.command.in(['pending', 'retry']),
          nextAttemptAt: database.command.lte(timestamp),
        })
        .orderBy('nextAttemptAt', 'asc')
        .limit(limit)
        .get()
      return rows(result).map(document => ({ releaseIntentId: document._id, ...withoutId(document) }))
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
