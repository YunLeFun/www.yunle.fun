import { describe, expect, it } from 'vitest'

import { createSsoClientRegistry } from '../../cloudfunctions/sso-ticket/sso-client-registry.js'
import snapshot from '../../cloudfunctions/sso-ticket/sso-client-registry.snapshot.js'
import {
  isAllowedOrigin,
  isAllowedRequestOrigin,
  readAllowedOriginRules,
  SsoRequestError,
  validateExchangeRequest,
  validateIssueRequest,
} from '../../cloudfunctions/sso-ticket/sso-request.js'

const NONCE = 'n'.repeat(32)
const CODE = 'c'.repeat(43)
const CHALLENGE = 'p'.repeat(43)
const VERIFIER = 'v'.repeat(64)
const rules = readAllowedOriginRules('https://*.yunle.fun,https://cms.example.com')
const returnOriginRules = readAllowedOriginRules('https://*.yunle.fun')
const options = { originRules: rules, returnOriginRules }

describe('sso-ticket request validation', () => {
  it('accepts exact HTTPS origins and constrained subdomain wildcards', () => {
    expect(isAllowedOrigin('https://drive.yunle.fun', rules)).toBe(true)
    expect(isAllowedOrigin('https://preview.drive.yunle.fun', rules)).toBe(true)
    expect(isAllowedOrigin('https://cms.example.com', rules)).toBe(true)
    expect(isAllowedOrigin('https://yunle.fun', rules)).toBe(false)
    expect(isAllowedOrigin('https://yunle.fun.evil.example', rules)).toBe(false)
    expect(isAllowedOrigin('https://drive.yunle.fun.evil.example', rules)).toBe(false)
    expect(isAllowedOrigin('https://drive.yunle.fun:8443', rules)).toBe(false)
    expect(isAllowedOrigin('https://drive.yunle.fun.', rules)).toBe(false)
    expect(isAllowedOrigin('https://drive.yunle.fun/path', rules)).toBe(false)
    expect(isAllowedOrigin('http://drive.yunle.fun', rules)).toBe(false)
    expect(readAllowedOriginRules('https://*.yunle.fun')).toEqual([{ subdomainSuffix: 'yunle.fun' }])
    expect(readAllowedOriginRules('https://*.localhost')).toEqual([])
    expect(readAllowedOriginRules('https://*.yunle.fun:8443')).toEqual([])
    expect(readAllowedOriginRules('https://*.*.yunle.fun')).toEqual([])
    expect(readAllowedOriginRules('http://*.yunle.fun')).toEqual([])
  })

  it('requires a redirect return URL to share the exact target origin', () => {
    expect(validateIssueRequest({
      mode: 'redirect',
      targetOrigin: 'https://drive.yunle.fun',
      returnUrl: 'https://drive.yunle.fun/callback?x=1',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, options)).toMatchObject({
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
    expect(validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://drive.yunle.fun', options)).toMatchObject({
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

  it('authorizes client_id through the registry and binds the grant to exchange', () => {
    const clientRegistry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    const registryOptions = {
      ...options,
      clientRegistry,
      issuerEnvironment: 'production',
      allowLegacyOriginClients: false,
      actorUid: 'developer-1',
    }
    const issue = validateIssueRequest({
      clientId: 'cms-web',
      mode: 'redirect',
      targetOrigin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }, registryOptions)
    expect(issue).toMatchObject({
      clientId: 'cms-web',
      issuerEnvironment: 'production',
      clientEnvironment: 'production',
      policyVersion: '2026-07-22.1',
      ruleId: 'cms-production',
    })
    expect(validateExchangeRequest({ clientId: 'cms-web', code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://cms.yunle.fun', registryOptions)).toMatchObject({
      clientId: 'cms-web',
      policyVersion: issue.policyVersion,
      ruleId: issue.ruleId,
    })
  })

  it('uses the registry as the CORS authority and refuses a client/origin mismatch', () => {
    const clientRegistry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    const registryOptions = { ...options, clientRegistry, allowLegacyOriginClients: false }
    expect(isAllowedRequestOrigin('https://cms.yunle.fun', registryOptions)).toBe(true)
    expect(isAllowedRequestOrigin('https://drive.yunle.fun', registryOptions)).toBe(false)
    expect(() => validateExchangeRequest({ clientId: 'cms-web', code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://drive.yunle.fun', registryOptions)).toThrow(/not registered/)
  })

  it('requires client_id on issue and exchange after the legacy adapter is disabled', () => {
    const clientRegistry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    const registryOptions = { ...options, clientRegistry, allowLegacyOriginClients: false }
    const issue = {
      mode: 'redirect',
      targetOrigin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      nonce: NONCE,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    }

    for (const action of [
      () => validateIssueRequest(issue, registryOptions),
      () => validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://cms.yunle.fun', registryOptions),
    ]) {
      try {
        action()
        throw new Error('expected client_required')
      }
      catch (error) {
        expect(error).toBeInstanceOf(SsoRequestError)
        expect(error.reason).toBe('client_required')
      }
    }
  })

  it('does not let the legacy adapter bypass a known registry environment denial', () => {
    const clientRegistry = createSsoClientRegistry(snapshot, {
      issuerEnvironment: 'production',
      developerUserIds: 'developer-1',
    })
    const localLegacyRules = readAllowedOriginRules('https://cms.yunle.localhost:3443')
    const registryOptions = {
      clientRegistry,
      allowLegacyOriginClients: true,
      originRules: localLegacyRules,
      returnOriginRules: localLegacyRules,
    }
    expect(isAllowedRequestOrigin('https://cms.yunle.localhost:3443', registryOptions)).toBe(false)
    expect(() => validateExchangeRequest({ code: CODE, nonce: NONCE, codeVerifier: VERIFIER }, 'https://cms.yunle.localhost:3443', registryOptions)).toThrow(/production issuer/)
  })
})
