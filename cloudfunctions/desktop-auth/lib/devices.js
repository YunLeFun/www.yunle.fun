/** Persistent adapter for proof-bound refresh-token grant families. */

'use strict'

const { createHash, randomBytes, randomUUID } = require('node:crypto')
const {
  AuthorizationError,
  createRefreshGrantMachine,
} = require('@yunlefun/authorization-core')
const {
  DEFAULT_REFRESH_ABSOLUTE_TTL_SEC,
  DEFAULT_REFRESH_IDLE_TTL_SEC,
  DEVICES_COLLECTION,
  REFRESH_TOKENS_COLLECTION,
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

function deviceDocumentId({ subject, clientId, deviceId }) {
  return hash(`${subject}\u0000${clientId}\u0000${deviceId}`)
}

function machine(options = {}) {
  return createRefreshGrantMachine({
    generateToken: options.generateToken || (() => randomBytes(32).toString('base64url')),
    idleSeconds: options.idleSeconds ?? DEFAULT_REFRESH_IDLE_TTL_SEC,
    absoluteSeconds: options.absoluteSeconds ?? DEFAULT_REFRESH_ABSOLUTE_TTL_SEC,
  })
}

async function revokeFamily(database, grantId, now) {
  await database.collection(REFRESH_TOKENS_COLLECTION)
    .where({ grantId })
    .update({ status: 'revoked', revokedAt: now })
  await database.collection(DEVICES_COLLECTION)
    .where({ grantId })
    .update({ status: 'revoked', revokedAt: now })
}

async function issueDeviceGrant(database, grant, options = {}) {
  const now = options.now ?? Date.now()
  const grantId = (options.generateGrantId || randomUUID)()
  const issued = machine(options).issue({
    grantId,
    subject: grant.subject,
    issuer: grant.issuer,
    clientId: grant.clientId,
    appId: grant.appId,
    scopes: grant.scopes,
    deviceId: grant.deviceId,
    deviceJkt: grant.deviceJkt,
    registrationFingerprint: grant.registrationFingerprint,
    now,
  })
  const deviceId = deviceDocumentId(grant)
  const existing = recordFromResult(
    await database.collection(DEVICES_COLLECTION).doc(deviceId).get(),
  )
  if (existing?.grantId)
    await revokeFamily(database, existing.grantId, now)

  await database.collection(REFRESH_TOKENS_COLLECTION).add({
    _id: issued.record.tokenHash,
    recordType: 'desktop_refresh_token',
    schemaVersion: 1,
    ...issued.record,
  })
  await database.collection(DEVICES_COLLECTION).doc(deviceId).set({
    recordType: 'desktop_device',
    schemaVersion: 1,
    status: 'active',
    grantId,
    uid: grant.subject,
    issuer: grant.issuer,
    clientId: grant.clientId,
    appId: grant.appId,
    scopes: [...grant.scopes],
    deviceId: grant.deviceId,
    deviceJkt: grant.deviceJkt,
    registrationFingerprint: grant.registrationFingerprint,
    deviceName: options.deviceName || '',
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  })
  return { deviceRefreshToken: issued.refreshToken }
}

async function refreshDeviceGrant(db, input, options = {}) {
  const now = options.now ?? Date.now()
  if (!input?.deviceRefreshToken || !input?.proofJkt)
    throw new AuthorizationError('invalid_request')
  if (!options.registry || typeof options.buildEntitlement !== 'function')
    throw new AuthorizationError('adapter_unavailable')

  const tokenId = hash(input.deviceRefreshToken)
  const rotated = await db.runTransaction(async (transaction) => {
    const record = recordFromResult(
      await transaction.collection(REFRESH_TOKENS_COLLECTION).doc(tokenId).get(),
    )
    if (!record)
      return { errorCode: 'invalid_grant' }
    if (record.status === 'used') {
      await revokeFamily(transaction, record.grantId, now)
      return { errorCode: 'refresh_reused' }
    }
    if (record.status === 'revoked')
      return { errorCode: 'grant_revoked' }

    options.registry.reauthorize(record)
    const next = machine(options).rotate(record, {
      refreshToken: input.deviceRefreshToken,
      proofJkt: input.proofJkt,
      now,
    })
    await transaction.collection(REFRESH_TOKENS_COLLECTION).doc(tokenId).set({
      recordType: record.recordType,
      schemaVersion: record.schemaVersion,
      ...next.previous,
    })
    await transaction.collection(REFRESH_TOKENS_COLLECTION).add({
      recordType: record.recordType,
      schemaVersion: record.schemaVersion,
      ...next.next,
      _id: next.next.tokenHash,
    })
    await transaction.collection(DEVICES_COLLECTION)
      .where({ grantId: record.grantId })
      .update({ lastSeenAt: now })
    return {
      refreshToken: next.refreshToken,
      grant: next.next,
    }
  })

  if (rotated.errorCode)
    throw new AuthorizationError(rotated.errorCode)
  const entitlement = await options.buildEntitlement({
    subject: rotated.grant.subject,
    issuer: rotated.grant.issuer,
    clientId: rotated.grant.clientId,
    appId: rotated.grant.appId,
    scopes: rotated.grant.scopes,
    deviceId: rotated.grant.deviceId,
    deviceJkt: rotated.grant.deviceJkt,
    now,
  })
  return {
    deviceRefreshToken: rotated.refreshToken,
    ...entitlement,
  }
}

async function revokeDevice(db, { uid, clientId, deviceId }, options = {}) {
  const now = options.now ?? Date.now()
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection(DEVICES_COLLECTION)
      .where({ uid, clientId, deviceId })
      .limit(1)
      .get()
    const device = recordFromResult(result)
    if (!device)
      return { revoked: false }
    await revokeFamily(transaction, device.grantId, now)
    return { revoked: true }
  })
}

async function listDevices(db, { uid }) {
  const { data } = await db.collection(DEVICES_COLLECTION).where({ uid }).get()
  return (Array.isArray(data) ? data : [])
    .filter(device => device.status === 'active' && !device.revokedAt)
    .map(device => ({
      clientId: device.clientId,
      appId: device.appId,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    }))
}

module.exports = {
  issueDeviceGrant,
  refreshDeviceGrant,
  revokeDevice,
  listDevices,
}
