import { describe, expect, it } from 'vitest'
import {
  buildSsoExplorerApps,
  isSsoExplorerAppSlug,
  ssoExplorerApps,
} from '../../app/config/sso-explorer'
import { productionRegistry } from '../../packages/authorization-core/src/registry'

describe('sso explorer configuration', () => {
  it('derives only active Web SSO clients from the authorization registry', () => {
    const controlPlaneClients = new Set(['admin-web', 'cook-mobile', 'studio-web'])
    const expectedAppIds = productionRegistry.clients
      .filter(client => client.status === 'active')
      .filter(client => !controlPlaneClients.has(client.clientId))
      .filter(client => client.adapters.some(adapter => adapter.kind === 'web-sso'))
      .map(client => client.appId)

    expect(ssoExplorerApps.map(app => app.appId).toSorted()).toEqual(expectedAppIds.toSorted())
    expect(ssoExplorerApps.some(app => app.appId === 'admin')).toBe(false)
    expect(ssoExplorerApps.every(app => app.origin.startsWith('https://'))).toBe(true)
    expect(ssoExplorerApps.every(app =>
      app.logoUrl.startsWith('/')
      || new URL(app.logoUrl).origin === app.origin,
    )).toBe(true)
    expect(ssoExplorerApps.find(app => app.appId === 'cms')?.logoUrl)
      .toBe('https://cms.yunle.fun/icon.svg')
    expect(ssoExplorerApps.find(app => app.appId === 'drive')?.logoUrl)
      .toBe('https://drive.yunle.fun/drive-mark.svg')
    expect(ssoExplorerApps.find(app => app.appId === 'drive')?.name)
      .toBe('云乐盘')
    expect(ssoExplorerApps.find(app => app.appId === 'saier')).toMatchObject({
      name: '云绘 Saier',
      description: '在线绘画、云端工程与协作房间',
      logoUrl: 'https://saier.yunle.fun/favicon.svg',
    })
    expect(ssoExplorerApps.find(app => app.appId === 'dayun-kicker')?.name)
      .toBe('暴力电驴')
    expect(ssoExplorerApps.find(app => app.appId === 'home')).toMatchObject({
      name: '云之彼端',
      description: '可编辑的云端智能家园',
      logoUrl: '/app-icons/home-brand-mark.svg',
      accent: '#687b67',
    })
    expect(ssoExplorerApps.find(app => app.appId === 'smap')).toMatchObject({
      name: 'SMAP 星际导航',
      description: '规划星际路线与模拟导航行程',
      logoUrl: 'https://smap.yunle.fun/smap-mark.svg',
    })
    expect(ssoExplorerApps.find(app => app.appId === 'fc')).toMatchObject({
      name: '怀旧游戏机',
      description: '在浏览器中重温经典红白机游戏',
      logoUrl: 'https://fc.yunle.fun/fc-mark.svg',
    })
  })

  it('maps public explorer slugs without treating unrelated apps as SSO clients', () => {
    expect(isSsoExplorerAppSlug('ai-sfc')).toBe(true)
    expect(isSsoExplorerAppSlug('valaxy')).toBe(false)
    expect(isSsoExplorerAppSlug('play')).toBe(true)
    expect(isSsoExplorerAppSlug('saier')).toBe(true)
    expect(isSsoExplorerAppSlug('smap')).toBe(true)
    expect(isSsoExplorerAppSlug('support')).toBe(true)
    expect(isSsoExplorerAppSlug('fc')).toBe(true)
  })

  it('prepares explorer presentation before activating a new Web SSO client', () => {
    const nextRegistry = {
      ...productionRegistry,
      clients: [
        ...productionRegistry.clients,
        {
          clientId: 'everything-generator-web',
          appId: 'everything-generator',
          displayName: '万物生成器',
          iconUrl: 'https://dao.yunle.fun/favicon.ico',
          status: 'active' as const,
          adapters: [{
            kind: 'web-sso' as const,
            consent: 'trusted' as const,
            allowedScopes: ['identity:bootstrap'],
            origins: ['https://dao.yunle.fun'],
            redirectUris: ['https://dao.yunle.fun/'],
          }],
        },
      ],
    }

    expect(buildSsoExplorerApps(nextRegistry).find(app => app.appId === 'everything-generator'))
      .toMatchObject({
        clientId: 'everything-generator-web',
        name: '万物生成器',
        origin: 'https://dao.yunle.fun',
        logoUrl: 'https://dao.yunle.fun/favicon.ico',
      })
  })

  it('shows one Web app when a native companion client shares the same app ID', () => {
    const cookClients = [
      {
        clientId: 'cook-mobile',
        appId: 'cook',
        displayName: 'Cook 食用手册',
        iconUrl: 'https://cook.yunyoujun.cn/favicon.svg',
        status: 'active' as const,
        adapters: [{
          kind: 'web-sso' as const,
          consent: 'explicit' as const,
          allowedScopes: ['identity:bootstrap'],
          origins: ['https://cook.yunyoujun.cn'],
          redirectUris: ['https://cook.yunyoujun.cn/auth/callback?platform=native'],
        }],
      },
      {
        clientId: 'cook-web',
        appId: 'cook',
        displayName: 'Cook 食用手册',
        iconUrl: 'https://cook.yunyoujun.cn/favicon.svg',
        status: 'active' as const,
        adapters: [{
          kind: 'web-sso' as const,
          consent: 'trusted' as const,
          allowedScopes: ['identity:bootstrap'],
          origins: ['https://cook.yunyoujun.cn'],
          redirectUris: ['https://cook.yunyoujun.cn/auth/callback'],
        }],
      },
    ]
    const nextRegistry = {
      ...productionRegistry,
      // Keep the fixture independent from the currently published Registry.
      // Once Cook is present in production, blindly appending the pair would
      // test duplicate fixture data instead of native companion filtering.
      clients: [
        ...productionRegistry.clients.filter(client => client.appId !== 'cook'),
        ...cookClients,
      ],
    }

    expect(buildSsoExplorerApps(nextRegistry).filter(app => app.appId === 'cook'))
      .toEqual([
        expect.objectContaining({
          clientId: 'cook-web',
          name: 'Cook 食用手册',
          origin: 'https://cook.yunyoujun.cn',
        }),
      ])
  })
})
