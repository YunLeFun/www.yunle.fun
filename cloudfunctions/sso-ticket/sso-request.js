/** Validation adapter for the redirect-only SSO v3 contract. */

'use strict'

const SUBJECT_FIELDS = ['uid', 'userId', 'subject', 'customUserId']
const NONCE_RE = /^[\w-]{32,128}$/
const CODE_RE = /^[\w-]{43}$/
const PKCE_CHALLENGE_RE = /^[\w-]{43}$/
const PKCE_VERIFIER_RE = /^[\w.~-]{43,128}$/
const SCOPE_RE = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9]*)?$/
const ALLOWED_PROMPTS = new Set(['consent', 'select_account'])

class SsoRequestError extends Error {
  constructor(reason, message = reason) {
    super(message)
    this.name = 'SsoRequestError'
    this.reason = reason
  }
}

function assertNoCallerSelectedSubject(payload) {
  for (const field of SUBJECT_FIELDS) {
    if (payload && Object.hasOwn(payload, field))
      throw new SsoRequestError('subject_not_allowed', `caller-selected ${field} is forbidden`)
  }
}

function readScopes(raw) {
  if (typeof raw !== 'string')
    return []
  const scopes = raw.trim().split(/\s+/).filter(Boolean)
  return scopes.length
    && scopes.every(scope => SCOPE_RE.test(scope))
    && new Set(scopes).size === scopes.length
    ? scopes
    : []
}

function exactUrl(raw) {
  if (typeof raw !== 'string')
    return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.hash
      || url.hostname.endsWith('.')
      || url.toString() !== raw) {
      return ''
    }
    return raw
  }
  catch {
    return ''
  }
}

function authorize(input, options) {
  if (!options?.clientRegistry)
    throw new SsoRequestError('registry_unavailable')
  try {
    return options.clientRegistry.authorize(input)
  }
  catch (error) {
    throw new SsoRequestError(error?.reason || 'registry_unavailable', error?.message)
  }
}

function isAllowedRequestOrigin(origin, options) {
  return options?.clientRegistry?.allowsOrigin(origin) === true
}

function validateIssueRequest(payload, options) {
  assertNoCallerSelectedSubject(payload)
  if (payload?.mode !== 'redirect')
    throw new SsoRequestError('invalid_request', 'redirect mode is required')

  const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
  const targetOrigin = typeof payload.targetOrigin === 'string' ? payload.targetOrigin : ''
  const returnUrl = exactUrl(payload.returnUrl)
  const scopes = readScopes(payload.scope)
  const nonce = typeof payload.nonce === 'string' && NONCE_RE.test(payload.nonce) ? payload.nonce : ''
  const codeChallenge = typeof payload.codeChallenge === 'string' && PKCE_CHALLENGE_RE.test(payload.codeChallenge)
    ? payload.codeChallenge
    : ''
  if (!clientId || !returnUrl || !scopes.length || !nonce)
    throw new SsoRequestError('invalid_request')
  if (!codeChallenge || payload.codeChallengeMethod !== 'S256')
    throw new SsoRequestError('pkce_required')
  if (new URL(returnUrl).origin !== targetOrigin)
    throw new SsoRequestError('return_url_not_allowed')

  const grant = authorize({
    clientId,
    origin: targetOrigin,
    returnUrl,
    scopes,
  }, options)
  return {
    mode: 'redirect',
    targetOrigin,
    returnUrl,
    nonce,
    codeChallenge,
    ...grant,
  }
}

/**
 * Resolves a host-assisted authorization request against the same authoritative
 * Registry that will be used again when the code is issued. Presentation data
 * is always derived from the Registry, never from the embedded page.
 */
function resolveAuthorizationRequest(payload, options) {
  const request = validateIssueRequest(payload, options)
  const suppliedPrompt = payload?.prompt
  if (suppliedPrompt !== undefined && !ALLOWED_PROMPTS.has(suppliedPrompt))
    throw new SsoRequestError('invalid_request', 'unsupported authorization prompt')

  const prompt = suppliedPrompt || (request.consent === 'explicit' ? 'consent' : '')
  return {
    issuer: request.issuer,
    policyVersion: request.policyVersion,
    registrationFingerprint: request.registrationFingerprint,
    request: {
      mode: request.mode,
      clientId: request.clientId,
      targetOrigin: request.targetOrigin,
      returnUrl: request.returnUrl,
      scope: request.scopes.join(' '),
      nonce: request.nonce,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: 'S256',
    },
    presentation: {
      appId: request.appId,
      applicationName: request.displayName,
      applicationOrigin: request.targetOrigin,
      ...(request.iconUrl ? { applicationIconUrl: request.iconUrl } : {}),
      permissionDescription: '账号标识、昵称和头像',
      consent: request.consent,
      ...(prompt ? { prompt } : {}),
    },
  }
}

function validateExchangeRequest(payload, requestOrigin, options) {
  assertNoCallerSelectedSubject(payload)
  const clientId = typeof payload?.clientId === 'string' ? payload.clientId : ''
  const redirectUri = exactUrl(payload?.redirectUri)
  const scopes = readScopes(payload?.scope)
  const code = typeof payload?.code === 'string' && CODE_RE.test(payload.code) ? payload.code : ''
  const nonce = typeof payload?.nonce === 'string' && NONCE_RE.test(payload.nonce) ? payload.nonce : ''
  const codeVerifier = typeof payload?.codeVerifier === 'string' && PKCE_VERIFIER_RE.test(payload.codeVerifier)
    ? payload.codeVerifier
    : ''
  if (!clientId || !redirectUri || !scopes.length || !code || !nonce || !codeVerifier)
    throw new SsoRequestError('invalid_request')

  const grant = authorize({
    clientId,
    origin: requestOrigin,
    returnUrl: redirectUri,
    scopes,
  }, options)
  return {
    code,
    nonce,
    codeVerifier,
    requestOrigin,
    redirectUri,
    ...grant,
  }
}

module.exports = {
  CODE_RE,
  NONCE_RE,
  PKCE_CHALLENGE_RE,
  PKCE_VERIFIER_RE,
  SUBJECT_FIELDS,
  SsoRequestError,
  assertNoCallerSelectedSubject,
  isAllowedRequestOrigin,
  readScopes,
  resolveAuthorizationRequest,
  validateExchangeRequest,
  validateIssueRequest,
}
