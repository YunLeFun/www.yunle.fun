/** Durable fixed-window limits for SSO issue and exchange operations. */

'use strict'

const { createHash } = require('node:crypto')

const SSO_RATE_LIMIT_COLLECTION = 'sso_security_limits'
const SSO_RATE_LIMIT_SCHEMA_VERSION = 1

const SSO_RATE_LIMIT_COLLECTION_MANIFEST = {
  collection: SSO_RATE_LIMIT_COLLECTION,
  access: 'server-only',
  browserRead: false,
  browserWrite: false,
  indexes: [{
    name: 'expires_at',
    fields: [{ field: 'expiresAt', order: 'asc' }],
    unique: false,
  }],
  retention: { terminalHours: 24 },
}

class SsoRateLimitError extends Error {
  constructor(message = 'SSO request rate limit exceeded') {
    super(message)
    this.name = 'SsoRateLimitError'
    this.reason = 'rate_limited'
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function firstDocument(result) {
  if (result?.code !== undefined && result.code !== 0 && result.code !== '0')
    throw new Error('rate limit database read failed')
  if (Array.isArray(result?.data))
    return isRecord(result.data[0]) ? result.data[0] : null
  return isRecord(result?.data) && Object.keys(result.data).length ? result.data : null
}

function assertWrite(result, requireModified = false) {
  if (!isRecord(result))
    throw new Error('rate limit database write returned an invalid result')
  if (result.code !== undefined && result.code !== 0 && result.code !== '0')
    throw new Error('rate limit database write failed')
  if (!requireModified)
    return
  const updated = result.updated ?? result.modifiedCount
  if (updated !== undefined && (!Number.isSafeInteger(updated) || updated < 1))
    throw new Error('rate limit database write did not modify a document')
}

function limitId(scope, key, windowStart) {
  return createHash('sha256')
    .update('ylf-sso-rate-v1\0')
    .update(scope)
    .update('\0')
    .update(key)
    .update('\0')
    .update(String(windowStart))
    .digest('hex')
}

function createSsoRateLimiter(database, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  return {
    async consume(input) {
      if (!/^[a-z][\w:-]{0,63}$/i.test(input.scope || '') || typeof input.key !== 'string' || !input.key || input.key.length > 512)
        throw new TypeError('invalid rate limit key')
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10_000)
        throw new TypeError('invalid rate limit')
      if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1_000 || input.windowMs > 86_400_000)
        throw new TypeError('invalid rate limit window')
      const current = now()
      const windowStart = Math.floor(current / input.windowMs) * input.windowMs
      const id = limitId(input.scope, input.key, windowStart)
      await database.runTransaction(async (transaction) => {
        const ref = transaction.collection(SSO_RATE_LIMIT_COLLECTION).doc(id)
        const record = firstDocument(await ref.get())
        if (!record) {
          assertWrite(await ref.set({
            recordType: 'sso_rate_limit',
            schemaVersion: SSO_RATE_LIMIT_SCHEMA_VERSION,
            scope: input.scope,
            count: 1,
            windowStart,
            expiresAt: windowStart + input.windowMs + 86_400_000,
          }))
          return
        }
        if (record.recordType !== 'sso_rate_limit' || record.schemaVersion !== SSO_RATE_LIMIT_SCHEMA_VERSION || record.scope !== input.scope)
          throw new Error('invalid rate limit record')
        const count = Number(record.count)
        if (!Number.isSafeInteger(count) || count < 1)
          throw new Error('invalid rate limit count')
        if (count >= input.limit)
          throw new SsoRateLimitError()
        assertWrite(await ref.update({ count: count + 1 }), true)
      })
    },

    async sweepExpired(input) {
      const before = input?.before
      const limit = input?.limit ?? 100
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
        throw new TypeError('invalid rate limit sweep request')
      const result = await database.collection(SSO_RATE_LIMIT_COLLECTION)
        .where({ expiresAt: database.command.lte(before) })
        .orderBy('expiresAt', 'asc')
        .limit(limit)
        .get()
      if (!isRecord(result) || (result.code !== undefined && result.code !== 0 && result.code !== '0'))
        throw new Error('rate limit sweep query failed')
      const records = Array.isArray(result.data) ? result.data.filter(isRecord) : []
      let removed = 0
      for (const record of records) {
        if (typeof record._id !== 'string' || !/^[a-f0-9]{64}$/.test(record._id))
          continue
        const removedResult = await database.collection(SSO_RATE_LIMIT_COLLECTION).doc(record._id).remove()
        if (!isRecord(removedResult) || (removedResult.code !== undefined && removedResult.code !== 0 && removedResult.code !== '0'))
          throw new Error('rate limit sweep remove failed')
        removed++
      }
      return { scanned: records.length, removed }
    },
  }
}

module.exports = {
  SSO_RATE_LIMIT_COLLECTION,
  SSO_RATE_LIMIT_COLLECTION_MANIFEST,
  SSO_RATE_LIMIT_SCHEMA_VERSION,
  SsoRateLimitError,
  createSsoRateLimiter,
  limitId,
}
