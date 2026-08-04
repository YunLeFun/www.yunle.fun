import type {
  AuthorizationError,
} from '../../packages/authorization-core/src/index'

import { describe, expect, it } from 'vitest'
import {
  createAuthorizationCore,
  developmentRegistry,
  productionRegistry,
} from '../../packages/authorization-core/src/index'

describe('production authorization registry', () => {
  it('enables the Saier Web client with exact production and development callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'saier-web',
      appId: 'saier',
      displayName: '云绘 Saier',
      iconUrl: 'https://saier.yunle.fun/favicon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://saier.yunle.fun'],
        redirectUris: ['https://saier.yunle.fun/'],
      }],
    })

    expect(developmentRegistry.clients).toContainEqual(expect.objectContaining({
      clientId: 'saier-web',
      appId: 'saier',
      status: 'active',
      adapters: [expect.objectContaining({
        origins: ['https://saier.yunle.localhost:3452'],
        redirectUris: ['https://saier.yunle.localhost:3452/'],
      })],
    }))

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'saier-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://saier.yunle.fun',
      redirectUri: 'https://saier.yunle.fun/',
    })).toMatchObject({
      appId: 'saier',
      clientId: 'saier-web',
      scopes: ['identity:bootstrap'],
    })

    expect(() => createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'smap-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://smap.yunle.fun',
      redirectUri: 'https://smap.yunle.fun/',
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'redirect_uri_not_allowed',
    }))
  })

  it('enables the non-discoverable Admin control-plane client with exact callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'admin-web',
      appId: 'admin',
      displayName: 'YunLeFun Admin',
      iconUrl: 'https://admin.yunle.fun/logo.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://admin.yunle.fun'],
        redirectUris: ['https://admin.yunle.fun/'],
      }],
    })

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'admin-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://admin.yunle.fun',
      redirectUri: 'https://admin.yunle.fun/',
    })).toMatchObject({
      appId: 'admin',
      clientId: 'admin-web',
      scopes: ['identity:bootstrap'],
    })
  })

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

  it('enables the SMAP static client with its exact production callback', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'smap-web',
      appId: 'smap',
      displayName: 'SMAP 星际导航',
      iconUrl: 'https://smap.yunle.fun/smap-logo.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://smap.yunle.fun'],
        redirectUris: ['https://smap.yunle.fun/tabs/profile'],
      }],
    })

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'smap-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://smap.yunle.fun',
      redirectUri: 'https://smap.yunle.fun/tabs/profile',
    })).toMatchObject({
      appId: 'smap',
      clientId: 'smap-web',
      scopes: ['identity:bootstrap'],
    })
  })

  it('enables the FC static Web client with exact callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'fc-web',
      appId: 'fc',
      displayName: '怀旧游戏机',
      iconUrl: 'https://fc.yunle.fun/favicon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://fc.elpsy.cn', 'https://fc.yunle.fun'],
        redirectUris: ['https://fc.elpsy.cn/', 'https://fc.yunle.fun/'],
      }],
    })

    expect(developmentRegistry.clients).toContainEqual(expect.objectContaining({
      clientId: 'fc-web',
      appId: 'fc',
      adapters: [expect.objectContaining({
        origins: ['https://fc.yunle.localhost:3453'],
        redirectUris: ['https://fc.yunle.localhost:3453/'],
      })],
    }))
  })

  it('enables the personal Studio client with exact callbacks', () => {
    expect(productionRegistry.clients).toContainEqual({
      clientId: 'studio-web',
      appId: 'studio',
      displayName: 'YunYouJun Studio',
      iconUrl: 'https://studio.yunyoujun.cn/icon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://studio.yunyoujun.cn'],
        redirectUris: ['https://studio.yunyoujun.cn/'],
      }],
    })

    expect(developmentRegistry.clients).toContainEqual(expect.objectContaining({
      clientId: 'studio-web',
      appId: 'studio',
      adapters: [expect.objectContaining({
        origins: ['https://studio.yunle.localhost:3454'],
        redirectUris: ['https://studio.yunle.localhost:3454/'],
      })],
    }))

    expect(createAuthorizationCore({ registry: productionRegistry }).authorize({
      issuer: productionRegistry.issuer,
      clientId: 'studio-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://studio.yunyoujun.cn',
      redirectUri: 'https://studio.yunyoujun.cn/',
    })).toMatchObject({
      appId: 'studio',
      clientId: 'studio-web',
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

      expect(adapter.origins).toContain(new URL(client.iconUrl).origin)
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
      ['admin-web', 'admin', 'web-sso', 'identity:bootstrap', 'https://admin.yunle.fun'],
      ['cms-web', 'cms', 'web-sso', 'identity:bootstrap', 'https://cms.yunle.fun'],
      ['drive-web', 'drive', 'web-sso', 'identity:bootstrap', 'https://drive.yunle.fun'],
      ['dayun-kicker-web', 'dayun-kicker', 'web-sso', 'identity:bootstrap', 'https://dayun-kicker.yunle.fun'],
      ['ai-sfc-web', 'ai-sfc', 'web-sso', 'identity:bootstrap', 'https://ai-sfc.yunle.fun'],
      ['home-web', 'home', 'web-sso', 'identity:bootstrap', 'https://home.yunle.fun'],
      ['wenta-web', 'wenta', 'web-sso', 'identity:bootstrap', 'https://wenta.yunle.fun'],
      ['play-web', 'play', 'web-sso', 'identity:bootstrap', 'https://play.yunle.fun'],
      ['smap-web', 'smap', 'web-sso', 'identity:bootstrap', 'https://smap.yunle.fun', 'https://smap.yunle.fun/tabs/profile'],
      ['fc-web', 'fc', 'web-sso', 'identity:bootstrap', 'https://fc.elpsy.cn'],
      ['studio-web', 'studio', 'web-sso', 'identity:bootstrap', 'https://studio.yunyoujun.cn'],
      ['support-web', 'support', 'web-sso', 'identity:bootstrap', 'https://support.yunle.fun'],
      ['saier-web', 'saier', 'web-sso', 'identity:bootstrap', 'https://saier.yunle.fun'],
      ['skykeeper-desktop', 'skykeeper', 'device', 'membership:read', undefined],
    ] as const

    expect(cases.map(([clientId, _appId, adapter, scope, origin, redirectUri]) => {
      const decision = authorization.authorize({
        issuer: productionRegistry.issuer,
        clientId,
        adapter,
        requestedScopes: [scope],
        ...(origin ? { origin, redirectUri: redirectUri ?? `${origin}/` } : {}),
      })
      return [decision.clientId, decision.appId, decision.adapter, decision.scopes]
    })).toEqual([
      ['admin-web', 'admin', 'web-sso', ['identity:bootstrap']],
      ['cms-web', 'cms', 'web-sso', ['identity:bootstrap']],
      ['drive-web', 'drive', 'web-sso', ['identity:bootstrap']],
      ['dayun-kicker-web', 'dayun-kicker', 'web-sso', ['identity:bootstrap']],
      ['ai-sfc-web', 'ai-sfc', 'web-sso', ['identity:bootstrap']],
      ['home-web', 'home', 'web-sso', ['identity:bootstrap']],
      ['wenta-web', 'wenta', 'web-sso', ['identity:bootstrap']],
      ['play-web', 'play', 'web-sso', ['identity:bootstrap']],
      ['smap-web', 'smap', 'web-sso', ['identity:bootstrap']],
      ['fc-web', 'fc', 'web-sso', ['identity:bootstrap']],
      ['studio-web', 'studio', 'web-sso', ['identity:bootstrap']],
      ['support-web', 'support', 'web-sso', ['identity:bootstrap']],
      ['saier-web', 'saier', 'web-sso', ['identity:bootstrap']],
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

  it('does not rescan Registry arrays on the authorization hot path', () => {
    let initialized = false
    let hotPathScans = 0
    const tracked = <T>(values: T[]): T[] => new Proxy(values, {
      get(target, property, receiver) {
        if (initialized && (property === Symbol.iterator || ['find', 'includes', 'some'].includes(String(property))))
          hotPathScans += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const adapter = {
      kind: 'web-sso' as const,
      consent: 'trusted' as const,
      allowedScopes: tracked(['identity:bootstrap']),
      origins: tracked(['https://sample.yunle.fun']),
      redirectUris: tracked(['https://sample.yunle.fun/']),
    }
    const authorization = createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-08-03.1',
        issuer: 'https://www.yunle.fun',
        clients: tracked([{
          clientId: 'sample-web',
          appId: 'sample',
          displayName: 'Sample',
          iconUrl: 'https://sample.yunle.fun/icon.svg',
          status: 'active',
          adapters: tracked([adapter]),
        }]),
      },
    })
    initialized = true

    expect(authorization.allowsOrigin({
      adapter: 'web-sso',
      origin: 'https://sample.yunle.fun',
    })).toBe(true)
    expect(authorization.authorize({
      issuer: 'https://www.yunle.fun',
      clientId: 'sample-web',
      adapter: 'web-sso',
      requestedScopes: ['identity:bootstrap'],
      origin: 'https://sample.yunle.fun',
      redirectUri: 'https://sample.yunle.fun/',
    })).toMatchObject({ clientId: 'sample-web', appId: 'sample' })
    expect(hotPathScans).toBe(0)
  })

  it('keeps local callbacks in the development issuer only', () => {
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
