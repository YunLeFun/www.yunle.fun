import { describe, expect, it } from 'vitest'
import {
  isSsoExplorerAppSlug,
  ssoExplorerApps,
} from '../../app/config/sso-explorer'

describe('sso explorer configuration', () => {
  it('derives only active Web SSO clients from the authorization registry', () => {
    expect(ssoExplorerApps.map(app => app.appId)).toEqual([
      'cms',
      'drive',
      'dayun-kicker',
      'ai-sfc',
      'home',
      'wenta',
      'play',
      'support',
    ])
    expect(ssoExplorerApps).toHaveLength(8)
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
    expect(ssoExplorerApps.find(app => app.appId === 'dayun-kicker')?.name)
      .toBe('暴力电驴')
    expect(ssoExplorerApps.find(app => app.appId === 'home')).toMatchObject({
      name: '云之彼端',
      description: '可编辑的云端智能家园',
      logoUrl: '/app-icons/home-brand-mark.svg',
      accent: '#687b67',
    })
  })

  it('maps public explorer slugs without treating unrelated apps as SSO clients', () => {
    expect(isSsoExplorerAppSlug('ai-sfc')).toBe(true)
    expect(isSsoExplorerAppSlug('valaxy')).toBe(false)
    expect(isSsoExplorerAppSlug('play')).toBe(true)
    expect(isSsoExplorerAppSlug('support')).toBe(true)
  })
})
