import { describe, expect, it } from 'vitest'

import {
  createSsoClientRegistry,
  SsoClientRegistryError,
} from '../../cloudfunctions/sso-ticket/sso-client-registry.js'

describe('sSO Client Registry adapter', () => {
  it('maps the shared production policy into the SSO grant contract', () => {
    const registry = createSsoClientRegistry({ issuerEnvironment: 'production' })

    expect(registry.authorize({
      clientId: 'cms-web',
      origin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scopes: ['identity:bootstrap'],
    })).toMatchObject({
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      appId: 'cms',
      origin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scopes: ['identity:bootstrap'],
      consent: 'trusted',
      policyVersion: '2026-07-26.1',
    })
  })

  it('requires client id, exact origin, exact redirect and explicit scope', () => {
    const registry = createSsoClientRegistry({ issuerEnvironment: 'production' })
    const base = {
      clientId: 'cms-web',
      origin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      scopes: ['identity:bootstrap'],
    }

    for (const invalid of [
      { ...base, clientId: '' },
      { ...base, origin: 'https://evil.example' },
      { ...base, returnUrl: 'https://cms.yunle.fun/settings' },
      { ...base, scopes: [] },
    ]) {
      expect(() => registry.authorize(invalid)).toThrow(SsoClientRegistryError)
    }
  })

  it('never allows a production issuer to authorize local callbacks', () => {
    const production = createSsoClientRegistry({ issuerEnvironment: 'production' })
    expect(() => production.authorize({
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      scopes: ['identity:bootstrap'],
    })).toThrow(SsoClientRegistryError)

    const development = createSsoClientRegistry({ issuerEnvironment: 'development' })
    expect(development.authorize({
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      scopes: ['identity:bootstrap'],
    })).toMatchObject({
      issuer: 'https://www.yunle.localhost:3000',
      appId: 'cms',
    })
  })
})
