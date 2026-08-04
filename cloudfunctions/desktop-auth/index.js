/**
 * desktop-auth — registered native-client authorization adapter.
 *
 * The shared authorization core owns Client Registry decisions, device-code
 * transitions, proof binding, refresh rotation and entitlement signing. This
 * function only adapts CloudBase persistence, account lookup and HTTP routing.
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const {
  AuthorizationError,
  createEntitlementKeyring,
  createProofOfPossessionVerifier,
  deviceJwkThumbprint,
} = require('@yunlefun/authorization-core')
const { createCloudBaseRegistryShadow } = require('@yunlefun/cloudbase-registry-shadow')

const { assertActiveAccountForUid, getAccountForUid } = require('./lib/account-proxy')
const { createDesktopClientRegistry } = require('./lib/client-registry')
const {
  approveDevice,
  denyDevice,
  describeDevice,
  pollDeviceToken,
  startDeviceAuth,
} = require('./lib/device-codes')
const {
  issueDeviceGrant,
  listDevices,
  refreshDeviceGrant,
  revokeDevice,
} = require('./lib/devices')
const { reserveProof } = require('./lib/proof-store')
const {
  DEFAULT_ENTITLEMENT_TTL_SEC,
  DEFAULT_VERIFICATION_URL,
  isAnonUid,
} = require('./lib/validation')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(result => result.result)

let registryShadow
function getRegistryShadow() {
  if (registryShadow)
    return registryShadow
  registryShadow = createCloudBaseRegistryShadow({
    db,
    environment: issuerEnvironment(),
    enabled: process.env.SSO_REGISTRY_SHADOW_ENABLED === 'true',
    logPrefix: 'desktop-auth',
    logger: console,
  })
  return registryShadow
}

async function observeRegistryShadow() {
  try {
    return await getRegistryShadow().observe()
  }
  catch (error) {
    console.warn('[desktop-auth] registry_shadow observer failure', error?.code || error?.message || 'unknown')
    return null
  }
}

function decodeSigningKey(raw) {
  const value = String(raw).trim()
  if (value.startsWith('{') || value.startsWith('-----'))
    return value
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim()
    if (decoded.startsWith('{') || decoded.includes('-----'))
      return decoded
  }
  catch {}
  return value
}

function issuerEnvironment() {
  return process.env.AUTH_ISSUER_ENVIRONMENT === 'development'
    ? 'development'
    : 'production'
}

function defaultCanonicalUrl(environment) {
  return environment === 'development'
    ? 'https://api.yunle.localhost:3000/desktop-auth'
    : 'https://api.yunle.fun/desktop-auth'
}

let runtimeCache
function loadRuntime() {
  if (runtimeCache)
    return runtimeCache
  const signingRaw = process.env.DESKTOP_AUTH_SIGNING_KEY
  if (!signingRaw)
    throw new Error('desktop-auth 未配置 DESKTOP_AUTH_SIGNING_KEY')
  const signingKeyText = decodeSigningKey(signingRaw)
  const privateKey = signingKeyText.startsWith('{')
    ? crypto.createPrivateKey({ key: JSON.parse(signingKeyText), format: 'jwk' })
    : crypto.createPrivateKey(signingKeyText)

  let kid = process.env.DESKTOP_AUTH_SIGNING_KID || ''
  if (!kid && signingKeyText.startsWith('{')) {
    try {
      kid = JSON.parse(signingKeyText).kid || ''
    }
    catch {}
  }
  if (!kid)
    throw new Error('desktop-auth 未配置 DESKTOP_AUTH_SIGNING_KID')

  let retiredKeys = []
  if (process.env.DESKTOP_AUTH_PUBLIC_KEYS) {
    const values = JSON.parse(process.env.DESKTOP_AUTH_PUBLIC_KEYS)
    retiredKeys = Object.entries(values)
      .filter(([retiredKid]) => retiredKid !== kid)
      .map(([retiredKid, publicKey]) => ({ kid: retiredKid, publicKey }))
  }

  const environment = issuerEnvironment()
  const registry = createDesktopClientRegistry({ issuerEnvironment: environment })
  runtimeCache = {
    registry,
    keyring: createEntitlementKeyring({
      issuer: registry.issuer,
      active: { kid, privateKey },
      verificationKeys: retiredKeys,
      generateJti: () => crypto.randomBytes(16).toString('base64url'),
    }),
    proofVerifier: createProofOfPossessionVerifier(),
    canonicalUrl: process.env.DESKTOP_AUTH_CANONICAL_URL || defaultCanonicalUrl(environment),
    internalToken: process.env.ACCOUNT_API_INTERNAL_TOKEN || '',
    verificationUri: process.env.DESKTOP_AUTH_VERIFICATION_URL || DEFAULT_VERIFICATION_URL,
    entitlementTtlSec: Number(process.env.DESKTOP_AUTH_ENTITLEMENT_TTL_SEC)
      || DEFAULT_ENTITLEMENT_TTL_SEC,
  }
  return runtimeCache
}

function getCallerUid() {
  try {
    const uid = app.auth().getUserInfo()?.uid || ''
    return isAnonUid(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

async function buildEntitlement(grant) {
  const runtime = loadRuntime()
  await assertActiveAccountForUid(callAccountApi, {
    serviceToken: runtime.internalToken,
    userId: grant.subject,
  })
  const account = await getAccountForUid(callAccountApi, {
    serviceToken: runtime.internalToken,
    userId: grant.subject,
  })
  const activeMembership = account.membership?.isActive
    && typeof account.membership?.level === 'string'
    && typeof account.membership?.expireAt === 'number'
    ? {
        level: account.membership.level,
        expiresAt: account.membership.expireAt,
      }
    : null
  return {
    entitlement: runtime.keyring.signMembershipEntitlement({
      subject: grant.subject,
      clientId: grant.clientId,
      appId: grant.appId,
      scopes: grant.scopes,
      deviceJkt: grant.deviceJkt,
      membership: activeMembership,
      now: grant.now,
      ttlSeconds: runtime.entitlementTtlSec,
    }),
    membership: activeMembership,
  }
}

function header(event, name) {
  const headers = event?.headers
  if (!headers || typeof headers !== 'object')
    return ''
  const expected = name.toLowerCase()
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === expected)
  return typeof found?.[1] === 'string' ? found[1] : ''
}

async function verifyHttpProof(event, now) {
  const runtime = loadRuntime()
  const proof = runtime.proofVerifier.verify(header(event, 'DPoP'), {
    method: 'POST',
    url: runtime.canonicalUrl,
    now,
  })
  await reserveProof(db, proof, { now })
  return proof
}

async function handleHttp(payload, event, now) {
  const runtime = loadRuntime()
  if (payload.action === 'getPublicKeys')
    return runtime.keyring.publicJwks()

  const proof = await verifyHttpProof(event, now)
  switch (payload.action) {
    case 'startDeviceAuth': {
      if (deviceJwkThumbprint(payload.devicePublicJwk) !== proof.jkt)
        throw new AuthorizationError('device_key_binding_invalid')
      return startDeviceAuth(db, payload, {
        now,
        registry: runtime.registry,
        verificationUri: runtime.verificationUri,
      })
    }
    case 'pollDeviceToken': {
      const polled = await pollDeviceToken(db, {
        deviceCode: payload.deviceCode,
        proofJkt: proof.jkt,
      }, {
        now,
        registry: runtime.registry,
        issueGrant: (transaction, grant, record) => issueDeviceGrant(transaction, grant, {
          now,
          deviceName: record.deviceName,
        }),
      })
      if (polled.status !== 'approved')
        return polled
      const entitlement = await buildEntitlement({ ...polled.grant, now })
      return {
        status: polled.status,
        deviceRefreshToken: polled.deviceRefreshToken,
        ...entitlement,
      }
    }
    case 'refreshEntitlement':
      return refreshDeviceGrant(db, {
        deviceRefreshToken: payload.deviceRefreshToken,
        proofJkt: proof.jkt,
      }, {
        now,
        registry: runtime.registry,
        buildEntitlement,
      })
    default:
      throw new AuthorizationError('unsupported_action')
  }
}

async function requireActiveCaller(runtime) {
  const uid = getCallerUid()
  if (!uid)
    throw new AuthorizationError('login_required')
  await assertActiveAccountForUid(callAccountApi, {
    serviceToken: runtime.internalToken,
    userId: uid,
  })
  return uid
}

async function handleSdk(payload, now) {
  const runtime = loadRuntime()
  const uid = await requireActiveCaller(runtime)
  switch (payload.action) {
    case 'describeDevice':
      return describeDevice(db, payload, { now })
    case 'approveDevice':
      return approveDevice(db, { userCode: payload.userCode, uid }, { now })
    case 'denyDevice':
      return denyDevice(db, payload, { now })
    case 'listDevices':
      return { devices: await listDevices(db, { uid }) }
    case 'revokeDevice':
      return revokeDevice(db, {
        uid,
        clientId: payload.clientId,
        deviceId: payload.deviceId,
      }, { now })
    default:
      throw new AuthorizationError('unsupported_action')
  }
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, DPoP',
}

function httpResponse(statusCode, body) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  }
}

function statusForError(error) {
  const code = error?.code
  if (code === 'authorization_pending' || code === 'slow_down')
    return 400
  if (code === 'invalid_grant'
    || code === 'grant_revoked'
    || code === 'refresh_expired'
    || code === 'refresh_reused'
    || code === 'proof_invalid'
    || code === 'proof_expired'
    || code === 'proof_replayed') {
    return 401
  }
  if (typeof code === 'string' && code.startsWith('account_'))
    return 403
  return 400
}

exports.main = async (event) => {
  const isHttp = !!event?.httpMethod
  if (isHttp && event.httpMethod === 'OPTIONS')
    return httpResponse(204, {})
  await observeRegistryShadow()

  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      return httpResponse(400, { error: 'invalid_request', code: 'invalid_request' })
    }
  }

  try {
    const result = isHttp
      ? await handleHttp(payload, event, Date.now())
      : await handleSdk(payload, Date.now())
    return isHttp ? httpResponse(200, result) : result
  }
  catch (error) {
    console.error('[desktop-auth] request failed:', payload.action, error?.code || error?.message)
    if (isHttp) {
      const code = error?.code || 'server_error'
      return httpResponse(statusForError(error), { error: code, code })
    }
    throw error
  }
}

exports._private = {
  buildEntitlement,
  getRegistryShadow,
  handleHttp,
  handleSdk,
  observeRegistryShadow,
  statusForError,
}
