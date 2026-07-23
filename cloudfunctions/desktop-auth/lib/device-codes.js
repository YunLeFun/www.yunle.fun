/**
 * Persistent adapter for the shared device-authorization state machine.
 *
 * Client identity, business attribution and scopes come only from Client
 * Registry. Device identifiers are RFC 7638 thumbprints of installation keys.
 */

'use strict'

const { createHash, randomBytes } = require('node:crypto')
const {
  AuthorizationError,
  createDeviceGrantMachine,
} = require('@yunlefun/authorization-core')
const { generateUserCode, normalizeUserCode } = require('./crypto')
const {
  CODE_STATUS,
  DEFAULT_DEVICE_CODE_TTL_SEC,
  DEFAULT_POLL_INTERVAL_SEC,
  DEFAULT_VERIFICATION_URL,
  DEVICE_CODES_COLLECTION,
  isAnonUid,
  normalizeDeviceName,
} = require('./validation')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function recordFromResult(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function createMachine(options = {}) {
  return createDeviceGrantMachine({
    generateDeviceCode: options.generateDeviceCode || (() => randomBytes(32).toString('base64url')),
    generateUserCode: options.generateUserCode || (() => generateUserCode(8).display),
  })
}

async function findByUserCode(db, userCode) {
  const normalized = normalizeUserCode(userCode)
  if (!normalized)
    return null
  const result = await db.collection(DEVICE_CODES_COLLECTION)
    .where({ userCodeHash: hash(normalized) })
    .limit(1)
    .get()
  return recordFromResult(result)
}

async function findByDeviceCode(db, deviceCode) {
  if (typeof deviceCode !== 'string' || !deviceCode)
    return null
  const result = await db.collection(DEVICE_CODES_COLLECTION).doc(hash(deviceCode)).get()
  return recordFromResult(result)
}

function isExpired(record, now) {
  return !record || typeof record.expiresAt !== 'number' || record.expiresAt <= now
}

async function startDeviceAuth(db, input, options = {}) {
  if (!options.registry)
    throw new AuthorizationError('registry_unavailable')
  if (Object.hasOwn(input || {}, 'appId'))
    throw new AuthorizationError('invalid_request')

  const authorization = options.registry.authorize({
    clientId: input?.clientId,
    scopes: input?.scope,
  })
  const now = options.now ?? Date.now()
  const ttlSec = options.ttlSec ?? DEFAULT_DEVICE_CODE_TTL_SEC
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL_SEC
  const verificationUri = options.verificationUri || DEFAULT_VERIFICATION_URL
  const machine = createMachine(options)
  const { deviceCode, userCode, record } = machine.start({
    authorization,
    devicePublicJwk: input?.devicePublicJwk,
    deviceName: normalizeDeviceName(input?.deviceName),
    now,
    ttlSeconds: ttlSec,
  })

  await db.collection(DEVICE_CODES_COLLECTION).add({
    _id: record.deviceCodeHash,
    recordType: 'desktop_device_code',
    schemaVersion: 1,
    ...record,
    consent: authorization.consent,
    interval,
    lastPolledAt: 0,
    version: 1,
  })

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    interval,
    expiresIn: ttlSec,
  }
}

async function describeDevice(db, input, options = {}) {
  const now = options.now ?? Date.now()
  const record = await findByUserCode(db, input?.userCode)
  if (isExpired(record, now))
    throw new AuthorizationError('device_code_expired')
  return {
    issuer: record.issuer,
    clientId: record.clientId,
    appId: record.appId,
    displayName: record.displayName,
    deviceName: record.deviceName,
    scope: record.scopes,
    consent: record.consent,
    status: record.status,
    expireAt: record.expiresAt,
  }
}

async function approveDevice(db, input, options = {}) {
  const now = options.now ?? Date.now()
  if (isAnonUid(input?.uid))
    throw new AuthorizationError('login_required')
  const found = await findByUserCode(db, input?.userCode)
  if (isExpired(found, now))
    throw new AuthorizationError('device_code_expired')

  const machine = createMachine(options)
  await db.runTransaction(async (transaction) => {
    const current = recordFromResult(
      await transaction.collection(DEVICE_CODES_COLLECTION).doc(found._id).get(),
    )
    if (!current)
      throw new AuthorizationError('device_code_expired')
    const next = machine.approve(current, { subject: input.uid, now })
    await transaction.collection(DEVICE_CODES_COLLECTION).doc(found._id).set({
      ...next,
      version: Number(current.version || 0) + 1,
    })
  })
  return { ok: true }
}

async function denyDevice(db, input, options = {}) {
  const now = options.now ?? Date.now()
  const found = await findByUserCode(db, input?.userCode)
  if (isExpired(found, now))
    throw new AuthorizationError('device_code_expired')
  await db.runTransaction(async (transaction) => {
    const current = recordFromResult(
      await transaction.collection(DEVICE_CODES_COLLECTION).doc(found._id).get(),
    )
    if (!current || current.status !== CODE_STATUS.PENDING)
      throw new AuthorizationError('device_code_not_pending')
    await transaction.collection(DEVICE_CODES_COLLECTION).doc(found._id).update({
      status: CODE_STATUS.DENIED,
      deniedAt: now,
      version: Number(current.version || 0) + 1,
    })
  })
  return { ok: true }
}

async function pollDeviceToken(db, input, options = {}) {
  const now = options.now ?? Date.now()
  const deviceCode = input?.deviceCode
  const proofJkt = input?.proofJkt
  if (!deviceCode || !proofJkt)
    throw new AuthorizationError('invalid_request')

  const id = hash(deviceCode)
  const machine = createMachine(options)
  return db.runTransaction(async (transaction) => {
    const record = recordFromResult(
      await transaction.collection(DEVICE_CODES_COLLECTION).doc(id).get(),
    )
    if (!record || isExpired(record, now))
      return { status: CODE_STATUS.EXPIRED }
    if (record.deviceJkt !== proofJkt)
      throw new AuthorizationError('device_code_binding_invalid')

    const interval = (record.interval || DEFAULT_POLL_INTERVAL_SEC) * 1000
    if (record.lastPolledAt && now - record.lastPolledAt < interval / 2)
      return { status: 'slow_down', interval: record.interval }
    await transaction.collection(DEVICE_CODES_COLLECTION).doc(id).update({
      lastPolledAt: now,
      version: Number(record.version || 0) + 1,
    })

    if (record.status === CODE_STATUS.DENIED)
      return { status: CODE_STATUS.DENIED }
    if (record.status === CODE_STATUS.CONSUMED)
      return { status: CODE_STATUS.EXPIRED }
    if (record.status !== CODE_STATUS.APPROVED)
      return { status: CODE_STATUS.PENDING }

    if (options.registry)
      options.registry.reauthorize(record)
    const transition = machine.consume(record, { deviceCode, proofJkt, now })
    const issued = await options.issueGrant(transaction, transition.grant, record)
    await transaction.collection(DEVICE_CODES_COLLECTION).doc(id).set({
      ...transition.next,
      consent: record.consent,
      interval: record.interval,
      lastPolledAt: now,
      recordType: record.recordType,
      schemaVersion: record.schemaVersion,
      version: Number(record.version || 0) + 2,
    })
    return { status: CODE_STATUS.APPROVED, grant: transition.grant, ...issued }
  })
}

module.exports = {
  findByUserCode,
  findByDeviceCode,
  startDeviceAuth,
  describeDevice,
  approveDevice,
  denyDevice,
  pollDeviceToken,
}
