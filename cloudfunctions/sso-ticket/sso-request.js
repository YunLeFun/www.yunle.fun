/** Pure validation for the SSO authorization-code issue and exchange contracts. */

'use strict'

const SUBJECT_FIELDS = ['uid', 'userId', 'subject', 'customUserId']
const NONCE_RE = /^[\w-]{32,128}$/
const CODE_RE = /^[\w-]{43}$/
const PKCE_CHALLENGE_RE = /^[\w-]{43}$/
const PKCE_VERIFIER_RE = /^[\w.~-]{43,128}$/

class SsoRequestError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'SsoRequestError'
    this.reason = reason
  }
}

function readAllowedOriginRules(raw) {
  if (typeof raw !== 'string')
    return []
  return raw.split(',').map(value => value.trim()).filter(Boolean).flatMap((value) => {
    const wildcardMatch = /^https:\/\/\*\.([^/:?#]+)\/?$/i.exec(value)
    if (wildcardMatch?.[1]) {
      try {
        const url = new URL(`https://${wildcardMatch[1]}`)
        const hostname = url.hostname.toLowerCase()
        const labels = hostname.split('.')
        if (url.hostname.endsWith('.')
          || url.port
          || labels.length < 2
          || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
          || isLoopbackHost(hostname)) {
          return []
        }
        return [{ subdomainSuffix: hostname }]
      }
      catch {
        return []
      }
    }
    try {
      if (value.includes('*'))
        return []
      const url = new URL(value)
      return url.protocol === 'https:' && url.origin === value.replace(/\/$/, '')
        ? [{ exactOrigin: url.origin }]
        : []
    }
    catch {
      return []
    }
  })
}

function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost' || normalized === '[::1]')
    return true
  const parts = normalized.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

function isAllowedOrigin(origin, rules, allowLocal = false) {
  let url
  try {
    url = new URL(origin)
  }
  catch {
    return false
  }
  if (allowLocal && url.protocol === 'http:' && isLoopbackHost(url.hostname))
    return true
  if (url.protocol !== 'https:' || url.origin !== origin || url.hostname.endsWith('.'))
    return false
  return rules.some((rule) => {
    if (rule.exactOrigin)
      return rule.exactOrigin === url.origin
    if (rule.subdomainSuffix) {
      if (url.port)
        return false
      const hostname = url.hostname.toLowerCase()
      return hostname !== rule.subdomainSuffix
        && hostname.endsWith(`.${rule.subdomainSuffix}`)
    }
    return false
  })
}

function assertNoCallerSelectedSubject(payload) {
  for (const field of SUBJECT_FIELDS) {
    if (payload && Object.hasOwn(payload, field))
      throw new SsoRequestError('subject_not_allowed', `caller-selected ${field} is forbidden`)
  }
}

function legacyClientGrant(origin, options) {
  if (!isAllowedOrigin(origin, options.originRules, options.allowLocal))
    throw new SsoRequestError('origin_not_allowed', 'target origin is not allowed')
  return {
    clientId: 'legacy-origin',
    issuerEnvironment: options.issuerEnvironment || 'production',
    clientEnvironment: 'legacy',
    origin,
    policyVersion: 'legacy-origin-v2',
    ruleId: 'legacy-origin',
  }
}

function authorizeRequestClient(input, options) {
  if (options.clientRegistry) {
    if (!input.clientId && options.allowLegacyOriginClients !== true)
      throw new SsoRequestError('client_required', 'registered SSO client is required')
    try {
      return options.clientRegistry.authorize(input)
    }
    catch (error) {
      const canUseLegacy = !input.clientId
        && error?.reason === 'client_unknown'
        && options.allowLegacyOriginClients === true
      if (!canUseLegacy)
        throw new SsoRequestError(error?.reason || 'registry_unavailable', error?.message || 'SSO client registry unavailable')
    }
  }
  else if (input.clientId) {
    // Transitional test/custom adapters that have not installed the registry yet still
    // authenticate by their exact legacy origin rules.
    return legacyClientGrant(input.origin, options)
  }

  const legacyAllowed = !options.clientRegistry || options.allowLegacyOriginClients === true
  if (!legacyAllowed)
    throw new SsoRequestError('client_required', 'registered SSO client is required')
  return legacyClientGrant(input.origin, options)
}

function isAllowedRequestOrigin(origin, options) {
  if (options.clientRegistry) {
    try {
      options.clientRegistry.authorize({ phase: 'cors', origin })
      return true
    }
    catch (error) {
      if (error?.reason !== 'client_unknown')
        return false
    }
  }
  return (!options.clientRegistry || options.allowLegacyOriginClients === true)
    && isAllowedOrigin(origin, options.originRules, options.allowLocal)
}

function validateIssueRequest(payload, options) {
  assertNoCallerSelectedSubject(payload)
  const mode = payload?.mode
  if (mode !== 'redirect' && mode !== 'interactive' && mode !== 'silent')
    throw new SsoRequestError('invalid_request', 'invalid SSO mode')
  const targetOrigin = typeof payload.targetOrigin === 'string' ? payload.targetOrigin : ''
  const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
  const nonce = typeof payload.nonce === 'string' && NONCE_RE.test(payload.nonce) ? payload.nonce : ''
  if (!nonce)
    throw new SsoRequestError('invalid_request', 'invalid SSO nonce')
  const codeChallenge = typeof payload.codeChallenge === 'string' && PKCE_CHALLENGE_RE.test(payload.codeChallenge)
    ? payload.codeChallenge
    : ''
  if (!codeChallenge || payload.codeChallengeMethod !== 'S256')
    throw new SsoRequestError('pkce_required', 'PKCE S256 is required')
  let returnUrl = ''
  if (mode === 'redirect') {
    try {
      const parsed = new URL(typeof payload.returnUrl === 'string' ? payload.returnUrl : '')
      if (parsed.origin !== targetOrigin)
        throw new Error('origin mismatch')
      returnUrl = parsed.toString()
    }
    catch {
      throw new SsoRequestError('return_url_not_allowed', 'return URL must match target origin')
    }
  }
  const grant = authorizeRequestClient({
    phase: 'issue',
    clientId,
    origin: targetOrigin,
    returnUrl,
    actorUid: options.actorUid,
  }, options)
  if (!options.clientRegistry
    && returnUrl
    && !isAllowedOrigin(new URL(returnUrl).origin, options.returnOriginRules, options.allowLocal)) {
    throw new SsoRequestError('return_url_not_allowed', 'return URL is not allowed')
  }
  if (grant.clientId === 'legacy-origin'
    && returnUrl
    && !isAllowedOrigin(new URL(returnUrl).origin, options.returnOriginRules, options.allowLocal)) {
    throw new SsoRequestError('return_url_not_allowed', 'return URL is not allowed')
  }
  return { mode, targetOrigin, nonce, returnUrl, codeChallenge, ...grant }
}

function validateExchangeRequest(payload, requestOrigin, options) {
  assertNoCallerSelectedSubject(payload)
  const clientId = typeof payload?.clientId === 'string' ? payload.clientId : ''
  const grant = authorizeRequestClient({ phase: 'exchange', clientId, origin: requestOrigin }, options)
  const code = typeof payload?.code === 'string' && CODE_RE.test(payload.code) ? payload.code : ''
  const nonce = typeof payload?.nonce === 'string' && NONCE_RE.test(payload.nonce) ? payload.nonce : ''
  const codeVerifier = typeof payload?.codeVerifier === 'string' && PKCE_VERIFIER_RE.test(payload.codeVerifier)
    ? payload.codeVerifier
    : ''
  if (!code || !nonce || !codeVerifier)
    throw new SsoRequestError('invalid_request', 'invalid code exchange request')
  return { code, nonce, codeVerifier, requestOrigin, ...grant }
}

module.exports = {
  CODE_RE,
  NONCE_RE,
  PKCE_CHALLENGE_RE,
  PKCE_VERIFIER_RE,
  SUBJECT_FIELDS,
  SsoRequestError,
  assertNoCallerSelectedSubject,
  authorizeRequestClient,
  isAllowedOrigin,
  isAllowedRequestOrigin,
  readAllowedOriginRules,
  validateExchangeRequest,
  validateIssueRequest,
}
