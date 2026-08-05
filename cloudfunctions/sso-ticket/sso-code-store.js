/** Transactional one-time SSO authorization-code persistence. */

'use strict'

const { createHash, randomBytes } = require('node:crypto')
const {
  AuthorizationError,
  createWebSsoCodeMachine,
} = require('@yunlefun/authorization-core')

const SSO_LOGIN_CODE_COLLECTION = 'sso_login_codes'
const SSO_LOGIN_CODE_SCHEMA_VERSION = 4
const DEFAULT_CODE_TTL_MS = 60_000
const TEST_LEASE_ID_RE = /^[\w:-]{4,128}$/

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
  const codeMachine = createWebSsoCodeMachine({ generateCode: randomCode })

  return {
    async issue(input) {
      if (!input
        || typeof input.uid !== 'string'
        || !input.uid
        || typeof input.issuer !== 'string'
        || !input.issuer
        || typeof input.clientId !== 'string'
        || !input.clientId
        || typeof input.appId !== 'string'
        || !input.appId
        || !Array.isArray(input.scopes)
        || input.scopes.length === 0
        || input.scopes.some(scope => typeof scope !== 'string' || !scope)
        || typeof input.targetOrigin !== 'string'
        || !input.targetOrigin
        || typeof input.returnUrl !== 'string'
        || !input.returnUrl
        || typeof input.nonce !== 'string'
        || !input.nonce
        || typeof input.codeChallenge !== 'string'
        || !input.codeChallenge
        || typeof input.policyVersion !== 'string'
        || !input.policyVersion
        || typeof input.registrationFingerprint !== 'string'
        || !input.registrationFingerprint
        || (input.testLeaseId !== undefined && !TEST_LEASE_ID_RE.test(input.testLeaseId))) {
        throw new SsoCodeStoreError('client_binding_invalid', 'authorization code client binding is invalid')
      }
      const issuedAt = now()
      const { code, record } = codeMachine.issue({
        subject: input.uid,
        issuer: input.issuer,
        clientId: input.clientId,
        appId: input.appId,
        scopes: input.scopes,
        origin: input.targetOrigin,
        redirectUri: input.returnUrl,
        nonce: input.nonce,
        codeChallenge: input.codeChallenge,
        policyVersion: input.policyVersion,
        registrationFingerprint: input.registrationFingerprint,
        now: issuedAt,
        ttlSeconds: ttlMs / 1000,
      })
      if (!/^[\w-]{43}$/.test(code))
        throw new SsoCodeStoreError('entropy_failure', 'authorization code source returned an invalid value')
      await database.runTransaction(async (transaction) => {
        if (await readDocument(transaction, record.codeHash))
          throw new SsoCodeStoreError('code_collision', 'authorization code collision')
        await setDocument(transaction, record.codeHash, {
          recordType: 'sso_login_code',
          schemaVersion: SSO_LOGIN_CODE_SCHEMA_VERSION,
          ...record,
          ...(input.testLeaseId ? { testLeaseId: input.testLeaseId } : {}),
          version: 1,
        })
      })
      return { code, expiresAt: record.expiresAt }
    },

    async consume(input) {
      const id = codeId(input.code)
      const consumedAt = now()
      let uid = ''
      let testLeaseId
      await database.runTransaction(async (transaction) => {
        const record = await readDocument(transaction, id)
        if (!record)
          throw new SsoCodeStoreError('code_invalid', 'authorization code does not exist')
        if (record.recordType !== 'sso_login_code' || record.schemaVersion !== SSO_LOGIN_CODE_SCHEMA_VERSION)
          throw new SsoCodeStoreError('code_invalid', 'authorization code record is invalid')
        let transition
        try {
          transition = codeMachine.consume(record, {
            code: input.code,
            issuer: input.issuer,
            clientId: input.clientId,
            appId: input.appId,
            scopes: input.scopes,
            origin: input.requestOrigin,
            redirectUri: input.redirectUri,
            nonce: input.nonce,
            codeVerifier: input.codeVerifier,
            policyVersion: input.policyVersion,
            registrationFingerprint: input.registrationFingerprint,
            now: consumedAt,
          })
        }
        catch (error) {
          if (error instanceof AuthorizationError)
            throw new SsoCodeStoreError(error.code, error.message)
          throw error
        }
        if (typeof transition.subject !== 'string' || !transition.subject)
          throw new SsoCodeStoreError('code_invalid', 'authorization code subject is invalid')
        uid = transition.subject
        if (record.testLeaseId !== undefined) {
          if (typeof record.testLeaseId !== 'string' || !TEST_LEASE_ID_RE.test(record.testLeaseId))
            throw new SsoCodeStoreError('code_invalid', 'authorization code test lease binding is invalid')
          testLeaseId = record.testLeaseId
        }
        await updateDocument(transaction, id, {
          status: transition.next.status,
          consumedAt: transition.next.consumedAt,
          version: Number(record.version || 0) + 1,
        })
      })
      return { uid, ...(testLeaseId ? { testLeaseId } : {}) }
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
