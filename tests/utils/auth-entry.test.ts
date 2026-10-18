import { describe, expect, it } from 'vitest'
import { resolveSsoClientPresentation } from '../../app/config/sso-explorer'
import { parseAuthEntry, readableHost, withAuthRedirect } from '../../app/utils/auth-entry'

function ssoPath(query: Record<string, string>) {
  return `/auth/sso?${new URLSearchParams(query).toString()}`
}

describe('login entry context', () => {
  it('treats a missing or unsafe redirect as a direct visit', () => {
    expect(parseAuthEntry(undefined)).toEqual({ kind: 'direct', redirect: '/' })
    expect(parseAuthEntry('https://evil.example/auth/sso?client_id=saier-web')).toEqual({ kind: 'direct', redirect: '/' })
    expect(parseAuthEntry('//evil.example/wallet')).toEqual({ kind: 'direct', redirect: '/' })
    expect(parseAuthEntry('/login?redirect=/wallet')).toEqual({ kind: 'direct', redirect: '/' })
  })

  it('recognises a cross-site SSO request and keeps the full return path', () => {
    const redirect = ssoPath({ client_id: 'saier-web', redirect_uri: 'https://saier.yunle.fun/', scope: 'identity:bootstrap' })
    expect(parseAuthEntry(redirect)).toEqual({
      kind: 'sso',
      redirect,
      clientId: 'saier-web',
      redirectUri: 'https://saier.yunle.fun/',
      native: false,
    })
  })

  it('marks native app hand-offs', () => {
    expect(parseAuthEntry(ssoPath({ client_id: 'life-ios', redirect_uri: 'https://life.yunle.fun/auth/callback' })))
      .toMatchObject({ kind: 'sso', native: true })
    expect(parseAuthEntry(ssoPath({
      client_id: 'cms-web',
      redirect_uri: 'https://cms.yunle.fun/',
      native_callback_uri: `yunlefun://auth/sso?state=${'s'.repeat(43)}`,
    }))).toMatchObject({ kind: 'sso', native: true })
  })

  it('recognises desktop device authorization and labelled site pages', () => {
    expect(parseAuthEntry('/link?code=WXYZ-1234')).toEqual({ kind: 'device', redirect: '/link?code=WXYZ-1234', userCode: 'WXYZ-1234' })
    expect(parseAuthEntry('/wallet?tab=coins')).toEqual({ kind: 'page', redirect: '/wallet?tab=coins', label: '钱包' })
    expect(parseAuthEntry('/settings/')).toMatchObject({ kind: 'page', label: '账号设置' })
    expect(parseAuthEntry('/somewhere-new')).toMatchObject({ kind: 'page', label: null })
    expect(parseAuthEntry('/auth/sso')).toMatchObject({ kind: 'page', label: null })
  })

  it('carries the entry between login and signup', () => {
    expect(withAuthRedirect('/signup', parseAuthEntry(undefined))).toEqual({ path: '/signup' })
    expect(withAuthRedirect('/login', parseAuthEntry('/wallet'))).toEqual({ path: '/login', query: { redirect: '/wallet' } })
  })

  it('reads only the host of a return URL', () => {
    expect(readableHost('https://saier.yunle.fun/a?b=1')).toBe('saier.yunle.fun')
    expect(readableHost('not a url')).toBe('')
  })
})

describe('sSO client presentation', () => {
  it('uses product branding for a registered client with an exact redirect URI', () => {
    expect(resolveSsoClientPresentation('cms-web', 'https://cms.yunle.fun/')).toMatchObject({
      appId: 'cms',
      name: '云栈',
      verified: true,
    })
  })

  it('flags a redirect URI that is not registered for the client', () => {
    expect(resolveSsoClientPresentation('cms-web', 'https://cms.yunle.fun/evil')).toMatchObject({ verified: false })
    expect(resolveSsoClientPresentation('cms-web', 'https://evil.example/')).toMatchObject({ verified: false })
  })

  it('falls back to registry data for clients without explorer presentation', () => {
    expect(resolveSsoClientPresentation('life-ios', 'https://life.yunle.fun/auth/callback')).toMatchObject({
      name: '云生',
      fallbackMark: '云',
      logoUrl: 'https://life.yunle.fun/favicon.png',
      verified: true,
    })
  })

  it('returns null for unknown clients', () => {
    expect(resolveSsoClientPresentation('nope-web', 'https://nope.example/')).toBeNull()
  })
})
