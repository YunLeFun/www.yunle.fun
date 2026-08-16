'use strict'

const AI_POINT_ACCOUNTS_COLLECTION = 'ai_point_accounts'
const AI_POINT_TRANSACTIONS_COLLECTION = 'ai_point_transactions'
const AI_USAGE_RECORDS_COLLECTION = 'ai_usage_records'
const AI_TASKS_COLLECTION = 'ai_tasks'
const AI_RUNTIME_CONTROL_COLLECTION = 'ai_runtime_control'

const AI_RUNTIME_COLLECTION_MANIFESTS = Object.freeze([
  {
    collection: AI_POINT_ACCOUNTS_COLLECTION,
    access: 'ADMINONLY',
    retention: 'ledger',
    indexes: [{
      name: 'user_id_unique',
      unique: true,
      fields: [{ field: 'userId', order: 'asc' }],
    }],
  },
  {
    collection: AI_POINT_TRANSACTIONS_COLLECTION,
    access: 'ADMINONLY',
    retention: 'ledger',
    indexes: [{
      name: 'user_created',
      unique: false,
      fields: [
        { field: 'userId', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }, {
      name: 'task_created',
      unique: false,
      fields: [
        { field: 'taskId', order: 'asc' },
        { field: 'createdAt', order: 'asc' },
      ],
    }, {
      name: 'idempotency_key',
      unique: false,
      fields: [{ field: 'idempotencyKey', order: 'asc' }],
    }],
  },
  {
    collection: AI_USAGE_RECORDS_COLLECTION,
    access: 'ADMINONLY',
    retention: 'ledger',
    indexes: [{
      name: 'task_attempt_unique',
      unique: true,
      fields: [
        { field: 'taskId', order: 'asc' },
        { field: 'attempt', order: 'asc' },
      ],
    }, {
      name: 'uid_created',
      unique: false,
      fields: [
        { field: 'uid', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }, {
      name: 'model_created',
      unique: false,
      fields: [
        { field: 'model', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }],
  },
  {
    collection: AI_TASKS_COLLECTION,
    access: 'ADMINONLY',
    retention: '7d',
    indexes: [{
      name: 'uid_status_created',
      unique: false,
      fields: [
        { field: 'uid', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ],
    }, {
      name: 'app_id_created',
      unique: false,
      fields: [
        { field: 'appId', order: 'asc' },
        { field: 'createdAt', order: 'asc' },
      ],
    }, {
      name: 'app_id_status_created',
      unique: false,
      fields: [
        { field: 'appId', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'createdAt', order: 'asc' },
      ],
    }, {
      name: 'app_id_status_lease_expiry',
      unique: false,
      fields: [
        { field: 'appId', order: 'asc' },
        { field: 'status', order: 'asc' },
        { field: 'leaseExpiresAt', order: 'asc' },
      ],
    }, {
      name: 'status_created',
      unique: false,
      fields: [
        { field: 'status', order: 'asc' },
        { field: 'createdAt', order: 'asc' },
      ],
    }, {
      name: 'status_lease_expiry',
      unique: false,
      fields: [
        { field: 'status', order: 'asc' },
        { field: 'leaseExpiresAt', order: 'asc' },
      ],
    }, {
      name: 'expires_at',
      unique: false,
      fields: [{ field: 'expiresAt', order: 'asc' }],
    }],
  },
  {
    collection: AI_RUNTIME_CONTROL_COLLECTION,
    access: 'ADMINONLY',
    retention: 'control',
    indexes: [],
  },
])

module.exports = {
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
  AI_RUNTIME_COLLECTION_MANIFESTS,
  AI_RUNTIME_CONTROL_COLLECTION,
  AI_TASKS_COLLECTION,
  AI_USAGE_RECORDS_COLLECTION,
}
