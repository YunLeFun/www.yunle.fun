/** Transactional one-time SSO authorization-code persistence. */

'use strict'

const { Buffer } = require('node:buffer')
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')

const SSO_LOGIN_CODE_COLLECTION = 'sso_login_codes'
const SSO_LOGIN_CODE_SCHEMA_VERSION = 3
const DEFAULT_CODE_TTL_MS = 60_000

const SSO_LOGIN_CODE_COLLECTION_MANIFEST = {
  collection: SSO_LOGIN_CODE_COLLECTION,
  access: 'server-only',
  browserRead: false,
  browserWrite: false,
  indexes: [
    {
      name: 'status_expires',
      fields: [{ field: 'status', order: 'asc' }, { field: 'expiresAt', order: 'asc' }],
      unique: false,
    },
    {
      name: 'expires_at',
      fields: [{ field: 'expiresAt', order: 'asc' }],
      unique: false,
    },
  ],
  retention: { terminalHours: 24 },
}

class SsoCodeStoreError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'SsoCodeStoreError'
    this.reason = reason
  }
}

function codeId(code) {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

function codeChallenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
}

function equalBinding(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length)
    return false
  return timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'))
}

function resultDocument(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function assertDatabaseResult(result, requireUpdated = false) {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('database operation returned an invalid result')
  if (result?.code !== undefined && result.code !== 0 && result.code !== '0') {
    const error = new Error(typeof result.message === 'string' ? result.message : 'database operation failed')
    error.code = result.code
    throw error
  }
  if (!requireUpdated)
    return
  const updated = result?.updated ?? result?.modifiedCount
  if (updated !== undefined && (!Number.isSafeInteger(updated) || Number(updated) < 1))
    throw new SsoCodeStoreError('code_conflict', 'authorization code update did not modify a document')
}

async function readDocument(database, id) {
  const result = await database.collection(SSO_LOGIN_CODE_COLLECTION).doc(id).get()
  assertDatabaseResult(result)
  return resultDocument(result)
}

async function setDocument(database, id, value) {
  const result = await database.collection(SSO_LOGIN_CODE_COLLECTION).doc(id).set(value)
  assertDatabaseResult(result)
}

async function updateDocument(database, id, value) {
  const result = await database.collection(SSO_LOGIN_CODE_COLLECTION).doc(id).update(value)
  assertDatabaseResult(result, true)
}

async function removeDocument(database, id) {
  const result = await database.collection(SSO_LOGIN_CODE_COLLECTION).doc(id).remove()
  assertDatabaseResult(result)
}

function createSsoCodeStore(database, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const randomCode = typeof options.randomCode === 'function'
    ? options.randomCode
    : () => randomBytes(32).toString('base64url')
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs >= 10_000 && options.ttlMs <= 300_000
    ? options.ttlMs
    : DEFAULT_CODE_TTL_MS

  return {
    async issue(input) {
      if (typeof input.clientId !== 'string'
        || !input.clientId
        || !['production', 'development'].includes(input.issuerEnvironment)
        || typeof input.clientEnvironment !== 'string'
        || !input.clientEnvironment
        || typeof input.policyVersion !== 'string'
        || !input.policyVersion
        || typeof input.ruleId !== 'string'
        || !input.ruleId) {
        throw new SsoCodeStoreError('client_binding_invalid', 'authorization code client binding is invalid')
      }
      const code = randomCode()
      if (!/^[\w-]{43}$/.test(code))
        throw new SsoCodeStoreError('entropy_failure', 'authorization code source returned an invalid value')
      const id = codeId(code)
      const issuedAt = now()
      await database.runTransaction(async (transaction) => {
        if (await readDocument(transaction, id))
          throw new SsoCodeStoreError('code_collision', 'authorization code collision')
        await setDocument(transaction, id, {
          recordType: 'sso_login_code',
          schemaVersion: SSO_LOGIN_CODE_SCHEMA_VERSION,
          uid: input.uid,
          clientId: input.clientId,
          issuerEnvironment: input.issuerEnvironment,
          clientEnvironment: input.clientEnvironment,
          targetOrigin: input.targetOrigin,
          redirectUri: input.returnUrl || '',
          nonce: input.nonce,
          codeChallenge: input.codeChallenge,
          policyVersion: input.policyVersion,
          ruleId: input.ruleId,
          mode: input.mode,
          status: 'issued',
          createdAt: issuedAt,
          expiresAt: issuedAt + ttlMs,
          version: 1,
        })
      })
      return { code, expiresAt: issuedAt + ttlMs }
    },

    async consume(input) {
      const id = codeId(input.code)
      const consumedAt = now()
      let uid = ''
      await database.runTransaction(async (transaction) => {
        const record = await readDocument(transaction, id)
        if (!record)
          throw new SsoCodeStoreError('code_invalid', 'authorization code does not exist')
        if (record.recordType !== 'sso_login_code' || ![2, SSO_LOGIN_CODE_SCHEMA_VERSION].includes(record.schemaVersion))
          throw new SsoCodeStoreError('code_invalid', 'authorization code record is invalid')
        if (record.status !== 'issued')
          throw new SsoCodeStoreError('code_used', 'authorization code has already been consumed')
        if (!Number.isSafeInteger(record.expiresAt) || consumedAt >= record.expiresAt)
          throw new SsoCodeStoreError('code_expired', 'authorization code has expired')
        if (record.targetOrigin !== input.requestOrigin || record.nonce !== input.nonce)
          throw new SsoCodeStoreError('code_binding_invalid', 'authorization code binding does not match')
        if (record.schemaVersion === SSO_LOGIN_CODE_SCHEMA_VERSION
          && (record.clientId !== input.clientId
            || record.issuerEnvironment !== input.issuerEnvironment
            || record.clientEnvironment !== input.clientEnvironment
            || record.policyVersion !== input.policyVersion
            || record.ruleId !== input.ruleId)) {
          throw new SsoCodeStoreError('client_binding_invalid', 'authorization code client binding does not match')
        }
        if (!equalBinding(record.codeChallenge, codeChallenge(input.codeVerifier)))
          throw new SsoCodeStoreError('pkce_invalid', 'PKCE verifier does not match')
        if (typeof record.uid !== 'string' || !record.uid)
          throw new SsoCodeStoreError('code_invalid', 'authorization code subject is invalid')
        uid = record.uid
        await updateDocument(transaction, id, {
          status: 'consumed',
          consumedAt,
          version: Number(record.version || 0) + 1,
        })
      })
      return { uid }
    },

    async sweepExpired(input) {
      const before = input?.before
      const limit = input?.limit ?? 100
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
        throw new TypeError('invalid SSO code sweep request')
      const result = await database.collection(SSO_LOGIN_CODE_COLLECTION)
        .where({ expiresAt: database.command.lte(before) })
        .orderBy('expiresAt', 'asc')
        .limit(limit)
        .get()
      assertDatabaseResult(result)
      const records = Array.isArray(result.data) ? result.data.filter(value => value && typeof value === 'object') : []
      let removed = 0
      for (const record of records) {
        if (typeof record._id !== 'string' || !/^[a-f0-9]{64}$/.test(record._id))
          continue
        await removeDocument(database, record._id)
        removed++
      }
      return { scanned: records.length, removed }
    },
  }
}

module.exports = {
  DEFAULT_CODE_TTL_MS,
  SSO_LOGIN_CODE_COLLECTION,
  SSO_LOGIN_CODE_COLLECTION_MANIFEST,
  SSO_LOGIN_CODE_SCHEMA_VERSION,
  SsoCodeStoreError,
  codeId,
  codeChallenge,
  createSsoCodeStore,
  resultDocument,
}
