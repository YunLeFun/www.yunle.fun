/** Ed25519 Web SSO identity-assertion runtime and JWKS projection. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const { createIdentityAssertionKeyring } = require('@yunlefun/authorization-core')

const DEFAULT_ASSERTION_TTL_SEC = 120
const MAX_ASSERTION_TTL_SEC = 300
const KEY_ID_RE = /^\w[\w.-]{0,127}$/

function decodeSigningKey(raw) {
  const value = String(raw || '').trim()
  if (value.startsWith('{') || value.startsWith('-----'))
    return value
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim()
    if (decoded.startsWith('{') || decoded.startsWith('-----'))
      return decoded
  }
  catch {}
  return value
}

function signingKey(raw) {
  const decoded = decodeSigningKey(raw)
  if (!decoded)
    return null
  return decoded.startsWith('{') ? JSON.parse(decoded) : decoded
}

function signingKid(raw, key) {
  const configured = String(raw || '').trim()
  const candidate = configured || (key && typeof key === 'object' && typeof key.kid === 'string'
    ? key.kid.trim()
    : '')
  return KEY_ID_RE.test(candidate) ? candidate : ''
}

function retiredVerificationKeys(raw, activeKid) {
  if (!raw)
    return []
  const values = JSON.parse(String(raw))
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new TypeError('SSO_IDENTITY_PUBLIC_KEYS must be a kid-to-JWK object')
  const entries = Object.entries(values)
  if (entries.some(([kid, publicKey]) => !KEY_ID_RE.test(kid) || !publicKey || typeof publicKey !== 'object' || Array.isArray(publicKey)))
    throw new TypeError('SSO_IDENTITY_PUBLIC_KEYS contains an invalid kid or JWK')
  return entries
    .filter(([kid]) => kid !== activeKid)
    .map(([kid, publicKey]) => ({ kid, publicKey }))
}

function assertionTtlSeconds(raw) {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 30 && value <= MAX_ASSERTION_TTL_SEC
    ? value
    : DEFAULT_ASSERTION_TTL_SEC
}

function createIdentityAssertionRuntime(options) {
  const key = signingKey(options.signingKey)
  const kid = signingKid(options.signingKid, key)
  if (!key || !kid)
    return null
  const keyring = createIdentityAssertionKeyring({
    issuer: options.issuer,
    active: { kid, privateKey: key },
    verificationKeys: retiredVerificationKeys(options.publicKeys, kid),
    generateJti: options.generateJti || (() => crypto.randomBytes(16).toString('base64url')),
  })
  const ttlSeconds = assertionTtlSeconds(options.ttlSeconds)
  return {
    sign(input) {
      return keyring.signIdentityAssertion({
        ...input,
        phoneNumberVerified: true,
        accountStatus: 'active',
        now: (options.now || Date.now)(),
        ttlSeconds,
      })
    },
    publicJwks: () => keyring.publicJwks(),
  }
}

module.exports = {
  DEFAULT_ASSERTION_TTL_SEC,
  MAX_ASSERTION_TTL_SEC,
  assertionTtlSeconds,
  createIdentityAssertionRuntime,
  decodeSigningKey,
}
