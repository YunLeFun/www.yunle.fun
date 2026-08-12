import { describe, expect, it } from 'vitest'

import { createSsoClientRegistry } from '../../cloudfunctions/sso-ticket/sso-client-registry.js'
import {
  isAllowedRequestOrigin,
  resolveAuthorizationRequest,
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

  it('resolves a normalized host authorization descriptor from the Registry', () => {
    const resolved = resolveAuthorizationRequest({
      clientId: 'dayun-kicker-web',
      mode: 'redirect',
      targetOrigin: 'https://dayun-kicker.yunle.fun',
      returnUrl: 'https://dayun-kicker.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      applicationName: '伪造名称',
      applicationIconUrl: 'https://evil.example/icon.svg',
    }, options)

    expect(resolved).toMatchObject({
      issuer: 'https://www.yunle.fun',
      request: {
        mode: 'redirect',
        clientId: 'dayun-kicker-web',
        targetOrigin: 'https://dayun-kicker.yunle.fun',
        returnUrl: 'https://dayun-kicker.yunle.fun/',
        scope: 'identity:bootstrap',
        nonce: NONCE,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
      },
      presentation: {
        appId: 'dayun-kicker',
        applicationName: '暴力电驴',
        applicationOrigin: 'https://dayun-kicker.yunle.fun',
        applicationIconUrl: 'https://dayun-kicker.yunle.fun/favicon.svg',
        permissionDescription: '账号标识、昵称和头像',
        consent: 'trusted',
      },
    })
    expect(resolved.registrationFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(resolved.presentation).not.toHaveProperty('prompt')
  })

  it('derives consent prompts from policy and rejects unsupported prompts', () => {
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
    expect(resolveAuthorizationRequest(base, options).presentation.prompt).toBeUndefined()
    expect(resolveAuthorizationRequest({ ...base, prompt: 'consent' }, options).presentation.prompt).toBe('consent')
    expect(resolveAuthorizationRequest({ ...base, prompt: 'select_account' }, options).presentation.prompt).toBe('select_account')
    expect(() => resolveAuthorizationRequest({ ...base, prompt: 'none' }, options)).toThrow(SsoRequestError)
  })

  it('rejects any mismatch in the registered client binding during resolution', () => {
    const base = {
      clientId: 'dayun-kicker-web',
      mode: 'redirect',
      targetOrigin: 'https://dayun-kicker.yunle.fun',
      returnUrl: 'https://dayun-kicker.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }
    for (const invalid of [
      { ...base, clientId: 'unknown-web' },
      { ...base, targetOrigin: 'https://evil.example' },
      { ...base, returnUrl: 'https://dayun-kicker.yunle.fun/callback' },
      { ...base, scope: 'identity:bootstrap membership:read' },
    ]) {
      expect(() => resolveAuthorizationRequest(invalid, options)).toThrow(SsoRequestError)
    }
  })
})
