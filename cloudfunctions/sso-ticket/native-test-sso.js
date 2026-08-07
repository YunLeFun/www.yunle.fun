/** Native host synthetic-identity admission for standard Web SSO codes. */

'use strict'

const { isValidTicketUid, tokensMatch } = require('./mint')
const { assertNoCallerSelectedSubject } = require('./sso-request')

const REF_RE = /^[\w:-]{4,128}$/
const MAX_LEASE_MS = 15 * 60 * 1000
const NATIVE_TEST_SSO_BINDINGS = Object.freeze([
  Object.freeze({
    platformAppId: 'yunjian',
    clientId: 'cms-web',
    appId: 'cms',
    targetOrigin: 'https://cms.yunle.fun',
    returnUrl: 'https://cms.yunle.fun/',
  }),
  Object.freeze({
    platformAppId: 'ai-sfc',
    clientId: 'ai-sfc-web',
    appId: 'ai-sfc',
    targetOrigin: 'https://ai-sfc.yunle.fun',
    returnUrl: 'https://ai-sfc.yunle.fun/',
  }),
])

class NativeTestSsoError extends Error {
  constructor(reason, message = reason) {
    super(message)
    this.name = 'NativeTestSsoError'
    this.reason = reason
  }
}

async function issueSsoCodeForTestLease(payload, deps) {
  if (typeof deps?.expectedToken !== 'string'
    || deps.expectedToken.length < 32
    || deps.expectedToken.length > 512) {
    throw new NativeTestSsoError('not_configured')
  }
  if (!tokensMatch(payload?.serviceToken, deps.expectedToken))
    throw new NativeTestSsoError('forbidden')
  try {
    assertNoCallerSelectedSubject(payload)
  }
  catch (error) {
    throw new NativeTestSsoError(error?.reason || 'subject_not_allowed')
  }
  const leaseId = typeof payload?.leaseId === 'string' && REF_RE.test(payload.leaseId)
    ? payload.leaseId
    : ''
  if (!leaseId)
    throw new NativeTestSsoError('invalid_request')

  const request = deps.validateRequest(payload)
  assertExactNativeTestRequest(request)
  const binding = await deps.resolveLease({ leaseId, request, now: deps.now() })
  if (!binding || !isValidTicketUid(binding.uid))
    throw new NativeTestSsoError('test_lease_binding_invalid')
  await deps.consumeRateLimit({
    scope: 'issue-test-lease',
    key: `${leaseId}\0${request.clientId}\0${request.targetOrigin}`,
  })
  const issued = await deps.issueCode({
    uid: binding.uid,
    testLeaseId: leaseId,
    ...request,
  })
  return { ok: true, code: issued.code, expiresAt: issued.expiresAt }
}

function validateNativeTestSsoContext(context, leaseId, request, now) {
  const { lease, identity } = context || {}
  const requestBinding = assertExactNativeTestRequest(request)
  if (!REF_RE.test(leaseId)
    || !lease
    || lease._id !== leaseId
    || lease.status !== 'active'
    || !Number.isSafeInteger(lease.expiresAt)
    || lease.expiresAt <= now
    || !Number.isSafeInteger(lease.sessionNotAfter)
    || lease.sessionNotAfter <= now
    || lease.expiresAt - now > MAX_LEASE_MS) {
    throw new NativeTestSsoError('test_lease_inactive')
  }
  if (!identity
    || identity._id !== lease.identityId
    || identity.uid !== lease.effectiveUid
    || identity.source !== 'managed'
    || identity.synthetic !== true
    || identity.status !== 'leased'
    || identity.activeLeaseId !== leaseId
    || identity.activeLeaseExpiresAt !== lease.expiresAt
    || identity.authProfile?.verificationMode !== 'synthetic-otp'
    || identity.authProfile?.virtualPhoneBound !== true
    || !/^[a-z0-9][a-z0-9-]{1,62}@yunlefun$/.test(identity.authProfile?.publicAlias || '')
    || !isValidTicketUid(identity.uid)) {
    throw new NativeTestSsoError('test_identity_binding_invalid')
  }
  if (!isExactLeaseTarget(lease.target, requestBinding))
    throw new NativeTestSsoError('test_lease_binding_invalid')
  return {
    uid: identity.uid,
    expiresAt: Math.min(lease.expiresAt, lease.sessionNotAfter),
    phoneNumberVerified: true,
  }
}

function assertExactNativeTestRequest(request) {
  const binding = request && NATIVE_TEST_SSO_BINDINGS.find(candidate => (
    candidate.clientId === request.clientId
    && candidate.appId === request.appId
    && candidate.targetOrigin === request.targetOrigin
    && candidate.returnUrl === request.returnUrl
  ))
  if (!binding
    || request.mode !== 'redirect'
    || request.issuer !== 'https://www.yunle.fun'
    || !Array.isArray(request.scopes)
    || request.scopes.length !== 1
    || request.scopes[0] !== 'identity:bootstrap') {
    throw new NativeTestSsoError('test_lease_binding_invalid')
  }
  return binding
}

function isExactLeaseTarget(target, binding) {
  return !!target
    && target.platformAppId === binding.platformAppId
    && target.origin === binding.targetOrigin
    && target.serviceAudience === 'sso-ticket'
    && target.billingAppId === undefined
    && Array.isArray(target.scopeIds)
    && target.scopeIds.length === 1
    && target.scopeIds[0] === 'native-sso'
    && Array.isArray(target.allowedActions)
    && target.allowedActions.length === 1
    && target.allowedActions[0] === 'identity:bootstrap'
}

module.exports = {
  MAX_LEASE_MS,
  NativeTestSsoError,
  assertExactNativeTestRequest,
  issueSsoCodeForTestLease,
  validateNativeTestSsoContext,
}
