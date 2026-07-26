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
    expect(ssoExplorerApps.every(app => app.origin.startsWith('https://'))).toBe(true)
    expect(ssoExplorerApps.every(app => new URL(app.logoUrl).origin === app.origin)).toBe(true)
    expect(ssoExplorerApps.find(app => app.appId === 'cms')?.logoUrl)
      .toBe('https://cms.yunle.fun/icon.svg')
    expect(ssoExplorerApps.find(app => app.appId === 'drive')?.logoUrl)
      .toBe('https://drive.yunle.fun/drive-mark.svg')
  })

  it('maps public explorer slugs without treating unrelated apps as SSO clients', () => {
    expect(isSsoExplorerAppSlug('ai-sfc')).toBe(true)
    expect(isSsoExplorerAppSlug('valaxy')).toBe(false)
    expect(isSsoExplorerAppSlug('play')).toBe(true)
    expect(isSsoExplorerAppSlug('support')).toBe(true)
  })
})
