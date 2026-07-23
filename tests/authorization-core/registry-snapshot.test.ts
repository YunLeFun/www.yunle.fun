import type {
  AuthorizationError,
} from '../../packages/authorization-core/src/index'

import { describe, expect, it } from 'vitest'
import {
  createAuthorizationCore,
  developmentRegistry,
  issuerCatalog,
  productionRegistry,
} from '../../packages/authorization-core/src/index'

describe('production authorization registry', () => {
  it('contains only the approved first-party protocol clients', () => {
    const authorization = createAuthorizationCore({ registry: productionRegistry })
    const cases = [
      ['cms-web', 'cms', 'web-sso', 'identity:bootstrap', 'https://cms.yunle.fun'],
      ['drive-web', 'drive', 'web-sso', 'identity:bootstrap', 'https://drive.yunle.fun'],
      ['dayun-kicker-web', 'dayun-kicker', 'web-sso', 'identity:bootstrap', 'https://dayun-kicker.yunle.fun'],
      ['ai-sfc-web', 'ai-sfc', 'web-sso', 'identity:bootstrap', 'https://ai-sfc.yunle.fun'],
      ['home-web', 'home', 'web-sso', 'identity:bootstrap', 'https://home.yunle.fun'],
      ['wenta-web', 'wenta', 'web-sso', 'identity:bootstrap', 'https://wenta.yunle.fun'],
      ['skykeeper-desktop', 'skykeeper', 'device', 'membership:read', undefined],
    ] as const

    expect(cases.map(([clientId, _appId, adapter, scope, origin]) => {
      const decision = authorization.authorize({
        issuer: productionRegistry.issuer,
        clientId,
        adapter,
        requestedScopes: [scope],
        ...(origin ? { origin, redirectUri: `${origin}/` } : {}),
      })
      return [decision.clientId, decision.appId, decision.adapter, decision.scopes]
    })).toEqual([
      ['cms-web', 'cms', 'web-sso', ['identity:bootstrap']],
      ['drive-web', 'drive', 'web-sso', ['identity:bootstrap']],
      ['dayun-kicker-web', 'dayun-kicker', 'web-sso', ['identity:bootstrap']],
      ['ai-sfc-web', 'ai-sfc', 'web-sso', ['identity:bootstrap']],
      ['home-web', 'home', 'web-sso', ['identity:bootstrap']],
      ['wenta-web', 'wenta', 'web-sso', ['identity:bootstrap']],
      ['skykeeper-desktop', 'skykeeper', 'device', ['membership:read']],
    ])
  })

  it('rejects a Web SSO redirect outside the client registration', () => {
    const authorization = createAuthorizationCore({ registry: productionRegistry })

    expect(() => authorization.authorize({
      issuer: productionRegistry.issuer,
      clientId: 'cms-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.fun',
      redirectUri: 'https://evil.example/',
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'redirect_uri_not_allowed',
    }))
  })

  it('keeps local callbacks in the development issuer only', () => {
    expect(issuerCatalog).toEqual({
      production: {
        environment: 'production',
        issuer: 'https://www.yunle.fun',
      },
      development: {
        environment: 'development',
        issuer: 'https://www.yunle.localhost:3000',
      },
    })

    expect(createAuthorizationCore({ registry: developmentRegistry }).authorize({
      issuer: 'https://www.yunle.localhost:3000',
      clientId: 'ai-sfc-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://ai-sfc.yunle.localhost:3448',
      redirectUri: 'https://ai-sfc.yunle.localhost:3448/',
    })).toMatchObject({
      clientId: 'ai-sfc-web',
      appId: 'ai-sfc',
    })

    expect(() => createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: 'https://www.yunle.fun',
      clientId: 'cms-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://cms.yunle.localhost:3443',
      redirectUri: 'https://cms.yunle.localhost:3443/',
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'origin_not_allowed',
    }))
  })

  it('answers CORS origin checks without weakening client authorization', () => {
    const authorization = createAuthorizationCore({ registry: productionRegistry })

    expect(authorization.allowsOrigin({
      adapter: 'web-sso',
      origin: 'https://drive.yunle.fun',
    })).toBe(true)
    expect(authorization.allowsOrigin({
      adapter: 'web-sso',
      origin: 'https://drive.yunle.fun.evil.example',
    })).toBe(false)
  })
})
