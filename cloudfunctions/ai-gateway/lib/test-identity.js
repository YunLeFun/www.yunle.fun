/** Synthetic identity classification, action mapping, and capability verification. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const TOKEN_ISSUER = 'https://admin.yunle.fun/test-broker'
const TOKEN_KIND = 'lease-capability'
const MAX_CAPABILITY_SECONDS = 15 * 60
const REGISTRY_VERSION = '2026-07-17.1'

const SYNTHETIC_ACTION_REGISTRY = Object.freeze({
  'everything-generator': Object.freeze({
    serviceAudience: 'ai-gateway',
    billingAppId: 'everything-generator',
    registryVersion: REGISTRY_VERSION,
    bizIdPattern: /^wish:[\w-]+:(audit|finalize)$/,
    scopeId: 'wish',
  }),
})

class SyntheticIdentityError extends Error {
  constructor(code, message, httpStatus = 403) {
    super(message)
    this.name = 'SyntheticIdentityError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

async function classifySyntheticIdentity(db, uid) {
  try {
    const result = await db.collection('test_identities').where({ uid }).limit(2).get()
    if (!result || !Array.isArray(result.data))
      throw new Error('invalid classification response')
    if (result.data.length === 0)
      return { synthetic: false }
    if (result.data.length !== 1
      || result.data[0]?.uid !== uid
      || result.data[0]?.synthetic !== true
      || typeof result.data[0]?._id !== 'string') {
      throw new Error('ambiguous synthetic identity classification')
    }
    return { synthetic: true, identity: result.data[0] }
  }
  catch (error) {
    if (error instanceof SyntheticIdentityError)
      throw error
    throw new SyntheticIdentityError(
      'synthetic_classification_unavailable',
      '测试身份分类服务暂时不可用。',
      503,
    )
  }
}

function isReadyFixedSyntheticIdentity(
  identity,
  expectedEnvironment = process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT,
) {
  return identity?.synthetic === true
    && identity.accountKind === 'fixed'
    && identity.status === 'ready'
    && (expectedEnvironment === 'test' || expectedEnvironment === 'production')
    && identity.environment === expectedEnvironment
}

function resolveSyntheticAction(appId, bizId) {
  const registered = SYNTHETIC_ACTION_REGISTRY[appId]
  const match = typeof bizId === 'string' ? registered?.bizIdPattern.exec(bizId) : null
  if (!registered || !match)
    throw new SyntheticIdentityError('synthetic_action_forbidden', '测试身份不允许执行该操作。')
  return {
    action: `${registered.scopeId}:${match[1]}`,
    billingAppId: registered.billingAppId,
    registryVersion: registered.registryVersion,
    scopeId: registered.scopeId,
    serviceAudience: registered.serviceAudience,
  }
}

function verifyLeaseCapability(token, rawKey, expected = {}) {
  try {
    const key = decode32ByteKey(rawKey)
    if (typeof token !== 'string' || token.length < 32 || token.length > 8192)
      throw new Error('invalid token length')
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part)))
      throw new Error('invalid compact token')
    const header = parseJsonPart(parts[0])
    const headerKeys = Object.keys(header).sort()
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || headerKeys.join(',') !== 'alg,typ')
      throw new Error('invalid protected header')
    const expectedSignature = crypto.createHmac('sha256', key)
      .update(`${parts[0]}.${parts[1]}`)
      .digest()
    const providedSignature = Buffer.from(parts[2], 'base64url')
    if (providedSignature.length !== expectedSignature.length
      || !crypto.timingSafeEqual(providedSignature, expectedSignature)) {
      throw new Error('invalid signature')
    }

    const claims = parseJsonPart(parts[1])
    const nowSeconds = Number.isInteger(expected.nowSeconds)
      ? expected.nowSeconds
      : Math.floor(Date.now() / 1000)
    const audience = requiredString(expected.audience, 'expected audience')
    if (claims.kind !== TOKEN_KIND
      || claims.iss !== TOKEN_ISSUER
      || claims.aud !== audience
      || claims.serviceAudience !== audience) {
      throw new Error('invalid issuer, audience, or kind')
    }
    const leaseId = requiredString(claims.leaseId, 'leaseId')
    if (claims.sub !== leaseId)
      throw new Error('invalid subject')
    const iat = requiredInteger(claims.iat, 'iat')
    const exp = requiredInteger(claims.exp, 'exp')
    if (iat > nowSeconds + 5 || exp <= nowSeconds || exp <= iat || exp - iat > MAX_CAPABILITY_SECONDS)
      throw new Error('invalid token lifetime')

    const verified = {
      kind: TOKEN_KIND,
      iss: TOKEN_ISSUER,
      sub: leaseId,
      aud: audience,
      leaseId,
      identityId: requiredString(claims.identityId, 'identityId'),
      effectiveUid: requiredString(claims.effectiveUid, 'effectiveUid'),
      platformAppId: requiredString(claims.platformAppId, 'platformAppId'),
      serviceAudience: audience,
      billingAppId: optionalString(claims.billingAppId, 'billingAppId'),
      scopeIds: requiredStringArray(claims.scopeIds, 'scopeIds'),
      allowedActions: requiredStringArray(claims.allowedActions, 'allowedActions'),
      identityVersion: requiredInteger(claims.identityVersion, 'identityVersion'),
      registryVersion: requiredString(claims.registryVersion, 'registryVersion'),
      iat,
      exp,
      jti: requiredString(claims.jti, 'jti'),
    }
    if (expected.uid !== undefined && verified.effectiveUid !== expected.uid)
      throw new Error('uid mismatch')
    if (expected.billingAppId !== undefined && verified.billingAppId !== expected.billingAppId)
      throw new Error('billing app mismatch')
    if (expected.scopeId !== undefined && !verified.scopeIds.includes(expected.scopeId))
      throw new Error('scope mismatch')
    if (expected.action !== undefined && !verified.allowedActions.includes(expected.action))
      throw new Error('action mismatch')
    if (expected.registryVersion !== undefined && verified.registryVersion !== expected.registryVersion)
      throw new Error('registry version mismatch')
    return verified
  }
  catch (error) {
    if (error instanceof SyntheticIdentityError)
      throw error
    throw new SyntheticIdentityError('lease_capability_invalid', '测试租约能力无效或已过期。')
  }
}

function decode32ByteKey(rawKey) {
  if (typeof rawKey !== 'string' || !/^[A-Z0-9+/]{43}=$/i.test(rawKey))
    throw new Error('invalid capability key')
  const key = Buffer.from(rawKey, 'base64')
  if (key.length !== 32 || key.toString('base64') !== rawKey)
    throw new Error('invalid capability key')
  return key
}

function parseJsonPart(value) {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('invalid token json')
  return parsed
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new Error(`invalid ${label}`)
  return value
}

function optionalString(value, label) {
  return value === undefined ? undefined : requiredString(value, label)
}

function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid ${label}`)
  return value
}

function requiredStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    throw new Error(`invalid ${label}`)
  const result = value.map(item => requiredString(item, label))
  if (new Set(result).size !== result.length)
    throw new Error(`invalid ${label}`)
  return result
}

module.exports = {
  MAX_CAPABILITY_SECONDS,
  REGISTRY_VERSION,
  SYNTHETIC_ACTION_REGISTRY,
  SyntheticIdentityError,
  classifySyntheticIdentity,
  isReadyFixedSyntheticIdentity,
  resolveSyntheticAction,
  verifyLeaseCapability,
}
