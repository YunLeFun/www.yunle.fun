import { describe, expect, it } from 'vitest'

import { createSsoClientRegistry } from '../../cloudfunctions/sso-ticket/sso-client-registry.js'
import {
  isAllowedRequestOrigin,
  SsoRequestError,
  validateExchangeRequest,
  validateIssueRequest,
} from '../../cloudfunctions/sso-ticket/sso-request.js'

const NONCE = 'n'.repeat(32)
const CODE = 'c'.repeat(43)
const CHALLENGE = 'p'.repeat(43)
const VERIFIER = 'v'.repeat(64)
const options = {
  clientRegistry: createSsoClientRegistry({ issuerEnvironment: 'production' }),
}

describe('sSO v3 request validation', () => {
  it('authorizes redirect-only issue and exchange requests through the shared registry', () => {
    const issue = validateIssueRequest({
      clientId: 'cms-web',
      mode: 'redirect',
      targetOrigin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, options)

    expect(issue).toMatchObject({
      clientId: 'cms-web',
      appId: 'cms',
      issuer: 'https://www.yunle.fun',
      scopes: ['identity:bootstrap'],
      returnUrl: 'https://cms.yunle.fun/',
    })

    expect(validateExchangeRequest({
      clientId: 'cms-web',
      redirectUri: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      code: CODE,
      nonce: NONCE,
      codeVerifier: VERIFIER,
    }, 'https://cms.yunle.fun', options)).toMatchObject({
      clientId: 'cms-web',
      appId: 'cms',
      scopes: ['identity:bootstrap'],
      redirectUri: 'https://cms.yunle.fun/',
    })
  })

  it('rejects every legacy or implicit authorization shape', () => {
    const base = {
      clientId: 'cms-web',
      mode: 'redirect',
      targetOrigin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }
    for (const invalid of [
      { ...base, clientId: undefined },
      { ...base, scope: undefined },
      { ...base, mode: 'silent' },
      { ...base, codeChallenge: undefined },
      { ...base, returnUrl: undefined },
    ]) {
      expect(() => validateIssueRequest(invalid, options)).toThrow(SsoRequestError)
    }
  })

  it('rejects caller-selected subjects and client/origin confusion', () => {
    expect(() => validateIssueRequest({
      clientId: 'cms-web',
      mode: 'redirect',
      targetOrigin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      uid: 'attacker',
    }, options)).toThrow(/forbidden/)

    expect(() => validateExchangeRequest({
      clientId: 'cms-web',
      redirectUri: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      code: CODE,
      nonce: NONCE,
      codeVerifier: VERIFIER,
    }, 'https://drive.yunle.fun', options)).toThrow(SsoRequestError)
  })

  it('uses only exact registered origins for CORS', () => {
    expect(isAllowedRequestOrigin('https://cms.yunle.fun', options)).toBe(true)
    expect(isAllowedRequestOrigin('https://cms.yunle.fun.evil.example', options)).toBe(false)
  })
})
