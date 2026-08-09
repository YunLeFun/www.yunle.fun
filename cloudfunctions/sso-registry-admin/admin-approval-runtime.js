/** Verify short-lived Admin approval evidence for production Registry releases. */

'use strict'

const { Buffer } = require('node:buffer')
const { createPublicKey, verify } = require('node:crypto')

const { RegistryAdminError } = require('./service')

const ADMIN_APPROVAL_ISSUER = 'https://admin.yunle.fun'
const ADMIN_APPROVAL_AUDIENCE = 'sso-registry-admin'
const ADMIN_APPROVAL_ACTION = 'approveAndQueueReleaseByAdmin'
const MAX_PROOF_TTL_SECONDS = 5 * 60
const CLOCK_SKEW_SECONDS = 30

const ADMIN_APPROVAL_TRUST_ANCHORS = Object.freeze({
  production: Object.freeze({
    'admin-registry-approval-20260809': Object.freeze({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'OdvCofOxe9PYrgV_UuZZC9ZkiavtGiGBo1Bl-SCGCNU',
    }),
  }),
})

const EXPECTED_CLAIM_KEYS = Object.freeze([
  'action',
  'aud',
  'baseCommitSha',
  'changeReason',
  'clientCount',
  'contentHash',
  'draftId',
  'environment',
  'exp',
  'iat',
  'iss',
  'jti',
  'login',
  'policyVersion',
  'role',
  'securityHash',
  'sub',
])

function text(value, code, maximum) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum)
    throw new RegistryAdminError(code)
  return value
}

function decodeBase64UrlSegment(segment, code, maximumBytes) {
  if (typeof segment !== 'string' || !/^[\w-]+$/.test(segment))
    throw new RegistryAdminError(code)
  let decoded
  try {
    decoded = Buffer.from(segment, 'base64url')
  }
  catch {
    throw new RegistryAdminError(code)
  }
  if (!decoded.length
    || decoded.length > maximumBytes
    || decoded.toString('base64url') !== segment) {
    throw new RegistryAdminError(code)
  }
  return decoded
}

function decodeJsonSegment(segment, code, maximumBytes) {
  const decoded = decodeBase64UrlSegment(segment, code, maximumBytes)
  try {
    const value = JSON.parse(decoded.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not an object')
    return value
  }
  catch {
    throw new RegistryAdminError(code)
  }
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function verifyAdminApprovalProof(proof, options = {}) {
  if (typeof proof !== 'string' || proof.length > 16_384)
    throw new RegistryAdminError('admin_approval_proof_invalid')
  const segments = proof.split('.')
  if (segments.length !== 3)
    throw new RegistryAdminError('admin_approval_proof_invalid')

  const [encodedHeader, encodedClaims, encodedSignature] = segments
  const header = decodeJsonSegment(encodedHeader, 'admin_approval_header_invalid', 1_024)
  if (!exactKeys(header, ['alg', 'kid', 'typ'])
    || header.alg !== 'EdDSA'
    || header.typ !== 'JWT') {
    throw new RegistryAdminError('admin_approval_header_invalid')
  }
  const keyId = text(header.kid, 'admin_approval_key_invalid', 128)
  const trustAnchors = options.trustAnchors || ADMIN_APPROVAL_TRUST_ANCHORS
  const publicJwk = trustAnchors.production?.[keyId]
  if (!publicJwk)
    throw new RegistryAdminError('admin_approval_key_untrusted')

  const signature = decodeBase64UrlSegment(
    encodedSignature,
    'admin_approval_signature_invalid',
    64,
  )
  if (signature.length !== 64 || !verify(
    null,
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key: publicJwk, format: 'jwk' }),
    signature,
  )) {
    throw new RegistryAdminError('admin_approval_signature_invalid')
  }

  const claims = decodeJsonSegment(encodedClaims, 'admin_approval_claims_invalid', 8_192)
  if (!exactKeys(claims, EXPECTED_CLAIM_KEYS))
    throw new RegistryAdminError('admin_approval_claims_invalid')
  if (claims.iss !== ADMIN_APPROVAL_ISSUER
    || claims.aud !== ADMIN_APPROVAL_AUDIENCE
    || claims.action !== ADMIN_APPROVAL_ACTION
    || claims.environment !== 'production'
    || claims.role !== 'owner') {
    throw new RegistryAdminError('admin_approval_claims_invalid')
  }

  text(claims.sub, 'admin_approval_subject_invalid', 128)
  text(claims.login, 'admin_approval_login_invalid', 128)
  text(claims.draftId, 'admin_approval_draft_invalid', 192)
  text(claims.policyVersion, 'admin_approval_policy_invalid', 128)
  text(claims.changeReason, 'admin_approval_reason_invalid', 512)
  text(claims.jti, 'admin_approval_jti_invalid', 128)
  if (!/^[a-f0-9]{40}$/.test(claims.baseCommitSha))
    throw new RegistryAdminError('admin_approval_base_commit_invalid')
  if (!/^[a-f0-9]{64}$/.test(claims.contentHash)
    || !/^[a-f0-9]{64}$/.test(claims.securityHash)) {
    throw new RegistryAdminError('admin_approval_hash_invalid')
  }
  if (!Number.isSafeInteger(claims.clientCount) || claims.clientCount < 0)
    throw new RegistryAdminError('admin_approval_client_count_invalid')
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
    || claims.exp <= claims.iat
    || claims.exp - claims.iat > MAX_PROOF_TTL_SECONDS) {
    throw new RegistryAdminError('admin_approval_time_invalid')
  }
  const nowSeconds = Math.floor((options.now || Date.now)() / 1_000)
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS
    || claims.iat < nowSeconds - MAX_PROOF_TTL_SECONDS
    || claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new RegistryAdminError('admin_approval_expired')
  }
  return claims
}

module.exports = {
  ADMIN_APPROVAL_ACTION,
  ADMIN_APPROVAL_AUDIENCE,
  ADMIN_APPROVAL_ISSUER,
  ADMIN_APPROVAL_TRUST_ANCHORS,
  verifyAdminApprovalProof,
}
