import { describe, expect, it } from 'vitest'

import {
  isAllowedOrigin,
  readAllowedOriginRules,
  SsoRequestError,
  validateExchangeRequest,
  validateIssueRequest,
} from '../../cloudfunctions/sso-ticket/sso-request.js'

const NONCE = 'n'.repeat(32)
const CODE = 'c'.repeat(43)
const CHALLENGE = 'p'.repeat(43)
const VERIFIER = 'v'.repeat(64)
const rules = readAllowedOriginRules('https://drive.yunle.fun,https://cms.example.com')
const returnOriginRules = readAllowedOriginRules('https://drive.yunle.fun')
const options = { originRules: rules, returnOriginRules }

describe('sso-ticket request validation', () => {
  it('accepts only exact HTTPS origins and rejects wildcard configuration', () => {
    expect(isAllowedOrigin('https://drive.yunle.fun', rules)).toBe(true)
    expect(isAllowedOrigin('https://cms.example.com', rules)).toBe(true)
    expect(isAllowedOrigin('https://yunle.fun', rules)).toBe(false)
    expect(isAllowedOrigin('https://yunle.fun.evil.example', rules)).toBe(false)
    expect(isAllowedOrigin('http://drive.yunle.fun', rules)).toBe(false)
    expect(readAllowedOriginRules('https://*.yunle.fun')).toEqual([])
  })

  it('requires a redirect return URL to share the exact target origin', () => {
    expect(validateIssueRequest({
      mode: 'redirect',
      targetOrigin: 'https://drive.yunle.fun',
      returnUrl: 'https://drive.yunle.fun/callback?x=1',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, options)).toEqual({
      mode: 'redirect',
      targetOrigin: 'https://drive.yunle.fun',
      returnUrl: 'https://drive.yunle.fun/callback?x=1',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
    })

    expect(() => validateIssueRequest({
      mode: 'redirect',
      targetOrigin: 'https://drive.yunle.fun',
      returnUrl: 'https://cms.example.com/callback',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, options)).toThrow(SsoRequestError)
  })

  it('rejects every caller-selected subject field on issue and exchange', () => {
    for (const field of ['uid', 'userId', 'subject', 'customUserId']) {
      expect(() => validateIssueRequest({
        mode: 'redirect',
        targetOrigin: 'https://drive.yunle.fun',
        returnUrl: 'https://drive.yunle.fun/callback',
        nonce: NONCE,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        [field]: 'attacker-selected-user',
      }, options)).toThrow(/forbidden/)
      expect(() => validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER, [field]: 'attacker' }, 'https://drive.yunle.fun', options)).toThrow(/forbidden/)
    }
  })

  it('binds exchange to an allowlisted request Origin and a strong nonce', () => {
    expect(validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://drive.yunle.fun', options)).toEqual({
      code: CODE,
      nonce: NONCE,
      codeVerifier: VERIFIER,
      requestOrigin: 'https://drive.yunle.fun',
    })
    expect(() => validateExchangeRequest({ code: CODE, nonce: 'short', codeVerifier: VERIFIER }, 'https://drive.yunle.fun', options)).toThrow(SsoRequestError)
    expect(() => validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://evil.example', options)).toThrow(SsoRequestError)
    expect(() => validateExchangeRequest({ code: CODE, nonce: NONCE }, 'https://drive.yunle.fun', options)).toThrow(SsoRequestError)
  })

  it('requires redirect destinations to pass the independent return-origin allowlist', () => {
    expect(() => validateIssueRequest({
      mode: 'redirect',
      targetOrigin: 'https://cms.example.com',
      returnUrl: 'https://cms.example.com/callback',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, options)).toThrow(SsoRequestError)
  })

  it('requires PKCE S256 on every authorization request', () => {
    expect(() => validateIssueRequest({
      mode: 'redirect',
      targetOrigin: 'https://drive.yunle.fun',
      returnUrl: 'https://drive.yunle.fun/callback',
      nonce: NONCE,
    }, options)).toThrow(/PKCE/)
  })
})
