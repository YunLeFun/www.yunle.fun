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
  it('enables the verified Play Web client with exact callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'play-web',
      appId: 'play',
      displayName: '云乐坊间',
      iconUrl: 'https://play.yunle.fun/favicon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://play.yunle.fun'],
        redirectUris: ['https://play.yunle.fun/'],
      }],
    })

    expect(developmentRegistry.clients).toContainEqual(expect.objectContaining({
      clientId: 'play-web',
      appId: 'play',
      status: 'active',
      adapters: [expect.objectContaining({
        origins: ['https://play.yunle.localhost:3449'],
        redirectUris: ['https://play.yunle.localhost:3449/'],
      })],
    }))

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'play-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://play.yunle.fun',
      redirectUri: 'https://play.yunle.fun/',
    })).toMatchObject({
      appId: 'play',
      clientId: 'play-web',
      scopes: ['identity:bootstrap'],
    })
  })

  it('enables the Support governance client with exact callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'support-web',
      appId: 'support',
      displayName: '云乐坊支持中心',
      iconUrl: 'https://support.yunle.fun/favicon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://support.yunle.fun'],
        redirectUris: ['https://support.yunle.fun/'],
      }],
    })

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'support-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://support.yunle.fun',
      redirectUri: 'https://support.yunle.fun/',
    })).toMatchObject({
      appId: 'support',
      clientId: 'support-web',
      scopes: ['identity:bootstrap'],
    })
  })

  it('registers stable client-owned icons for every Web SSO client', () => {
    for (const client of productionRegistry.clients) {
      const adapter = client.adapters.find(candidate => candidate.kind === 'web-sso')
      if (!adapter)
        continue

      expect('iconUrl' in client ? client.iconUrl : null, client.clientId).toBeTruthy()
      if (!('iconUrl' in client))
        continue

      expect(new URL(client.iconUrl).origin).toBe(adapter.origins[0])
      expect(new URL(client.iconUrl).search).toBe('')
    }
  })

  it('exposes the localized Drive and Home brand metadata', () => {
    expect(productionRegistry.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientId: 'drive-web',
        displayName: '云乐盘',
        iconUrl: 'https://drive.yunle.fun/drive-mark.svg',
      }),
      expect.objectContaining({
        clientId: 'home-web',
        displayName: '云之彼端',
        iconUrl: 'https://home.yunle.fun/brand-mark.svg',
      }),
    ]))

    expect(developmentRegistry.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientId: 'drive-web',
        displayName: '云乐盘',
      }),
      expect.objectContaining({
        clientId: 'home-web',
        displayName: '云之彼端',
        iconUrl: 'https://home.yunle.localhost:3446/brand-mark.svg',
      }),
    ]))
  })

  it('contains only the approved first-party protocol clients', () => {
    const authorization = createAuthorizationCore({ registry: productionRegistry })
    const cases = [
      ['cms-web', 'cms', 'web-sso', 'identity:bootstrap', 'https://cms.yunle.fun'],
      ['drive-web', 'drive', 'web-sso', 'identity:bootstrap', 'https://drive.yunle.fun'],
      ['dayun-kicker-web', 'dayun-kicker', 'web-sso', 'identity:bootstrap', 'https://dayun-kicker.yunle.fun'],
      ['ai-sfc-web', 'ai-sfc', 'web-sso', 'identity:bootstrap', 'https://ai-sfc.yunle.fun'],
      ['home-web', 'home', 'web-sso', 'identity:bootstrap', 'https://home.yunle.fun'],
      ['wenta-web', 'wenta', 'web-sso', 'identity:bootstrap', 'https://wenta.yunle.fun'],
      ['play-web', 'play', 'web-sso', 'identity:bootstrap', 'https://play.yunle.fun'],
      ['support-web', 'support', 'web-sso', 'identity:bootstrap', 'https://support.yunle.fun'],
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
      ['play-web', 'play', 'web-sso', ['identity:bootstrap']],
      ['support-web', 'support', 'web-sso', ['identity:bootstrap']],
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
