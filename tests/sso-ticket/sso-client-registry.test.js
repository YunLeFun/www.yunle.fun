import { describe, expect, it } from 'vitest'

import {
  createSsoClientRegistry,
  SsoClientRegistryError,
} from '../../cloudfunctions/sso-ticket/sso-client-registry.js'
import snapshot from '../../cloudfunctions/sso-ticket/sso-client-registry.snapshot.js'

describe('versioned SSO client registry', () => {
  it('authorizes a production client and exact registered redirect URI', () => {
    const registry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    expect(registry.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/',
      actorUid: 'user-1',
    })).toMatchObject({
      clientId: 'cms-web',
      issuerEnvironment: 'production',
      clientEnvironment: 'production',
      policyVersion: '2026-07-22.1',
      ruleId: 'cms-production',
    })
  })

  it('resolves a migrating client by its unique exact origin', () => {
    const registry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    expect(registry.authorize({ phase: 'exchange', origin: 'https://cms.yunle.fun' })).toMatchObject({ clientId: 'cms-web' })
  })

  it('rejects client/origin confusion and non-exact redirect URIs', () => {
    const registry = createSsoClientRegistry(snapshot, { issuerEnvironment: 'production' })
    expect(() => registry.authorize({ phase: 'issue', clientId: 'cms-web', origin: 'https://evil.example' })).toThrow(SsoClientRegistryError)
    expect(() => registry.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.fun',
      returnUrl: 'https://cms.yunle.fun/settings',
      actorUid: 'user-1',
    })).toThrow(/not registered exactly/)
  })

  it('isolates managed local clients and requires an allowlisted developer', () => {
    const safeProduction = createSsoClientRegistry(snapshot, {
      issuerEnvironment: 'production',
      developerUserIds: 'developer-1',
    })
    expect(() => safeProduction.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      actorUid: 'developer-1',
    })).toThrow(/production issuer does not allow local clients/)

    const breakGlassProduction = createSsoClientRegistry(snapshot, {
      issuerEnvironment: 'production',
      developerUserIds: 'developer-1',
      allowProductionLocalClients: true,
    })
    expect(() => breakGlassProduction.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      actorUid: 'someone-else',
    })).toThrow(/registered developer/)
    expect(breakGlassProduction.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      actorUid: 'developer-1',
    })).toMatchObject({ clientEnvironment: 'local', ruleId: 'cms-managed-local' })
  })

  it('allows the same managed local registration in a development issuer', () => {
    const registry = createSsoClientRegistry(snapshot, {
      issuerEnvironment: 'development',
      developerUserIds: 'developer-1',
    })
    expect(registry.authorize({
      phase: 'issue',
      clientId: 'cms-web',
      origin: 'https://cms.yunle.localhost:3443',
      returnUrl: 'https://cms.yunle.localhost:3443/',
      actorUid: 'developer-1',
    })).toMatchObject({ issuerEnvironment: 'development', clientEnvironment: 'local' })
  })
})
