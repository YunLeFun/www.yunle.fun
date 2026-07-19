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

function validateIssueRequest(payload, options) {
  assertNoCallerSelectedSubject(payload)
  const mode = payload?.mode
  if (mode !== 'redirect' && mode !== 'interactive' && mode !== 'silent')
    throw new SsoRequestError('invalid_request', 'invalid SSO mode')
  const targetOrigin = typeof payload.targetOrigin === 'string' ? payload.targetOrigin : ''
  if (!isAllowedOrigin(targetOrigin, options.originRules, options.allowLocal))
    throw new SsoRequestError('origin_not_allowed', 'target origin is not allowed')
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
      if (parsed.origin !== targetOrigin || !isAllowedOrigin(parsed.origin, options.returnOriginRules, options.allowLocal))
        throw new Error('origin mismatch')
      returnUrl = parsed.toString()
    }
    catch {
      throw new SsoRequestError('return_url_not_allowed', 'return URL must match target origin')
    }
  }
  return { mode, targetOrigin, nonce, returnUrl, codeChallenge }
}

function validateExchangeRequest(payload, requestOrigin, options) {
  assertNoCallerSelectedSubject(payload)
  if (!isAllowedOrigin(requestOrigin, options.originRules, options.allowLocal))
    throw new SsoRequestError('origin_not_allowed', 'request origin is not allowed')
  const code = typeof payload?.code === 'string' && CODE_RE.test(payload.code) ? payload.code : ''
  const nonce = typeof payload?.nonce === 'string' && NONCE_RE.test(payload.nonce) ? payload.nonce : ''
  const codeVerifier = typeof payload?.codeVerifier === 'string' && PKCE_VERIFIER_RE.test(payload.codeVerifier)
    ? payload.codeVerifier
    : ''
  if (!code || !nonce || !codeVerifier)
    throw new SsoRequestError('invalid_request', 'invalid code exchange request')
  return { code, nonce, codeVerifier, requestOrigin }
}

module.exports = {
  CODE_RE,
  NONCE_RE,
  PKCE_CHALLENGE_RE,
  PKCE_VERIFIER_RE,
  SUBJECT_FIELDS,
  SsoRequestError,
  assertNoCallerSelectedSubject,
  isAllowedOrigin,
  readAllowedOriginRules,
  validateExchangeRequest,
  validateIssueRequest,
}
