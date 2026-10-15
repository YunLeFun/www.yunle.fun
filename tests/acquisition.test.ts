import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAcquisitionTouch, parseAcquisitionContext, readAcquisitionContext, readAcquisitionSsoRequest } from '../app/utils/acquisition'
import { captureAcquisitionEntry, captureBrowserAcquisition } from '../app/utils/acquisition-storage'

function store() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

function ssoQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: 'cook-web',
    redirect_uri: 'https://cook.yunyoujun.cn/auth/callback',
    nonce: 'a'.repeat(43),
    scope: 'identity:bootstrap',
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('acquisition across authentication redirects', () => {
  const now = Date.now()
  let stores: { local: ReturnType<typeof store>, session: ReturnType<typeof store> }
  beforeEach(() => {
    stores = { local: store(), session: store() }
  })

  it('captures only allowed fields, strips URL queries and keeps external referrer host', () => {
    const result = captureAcquisitionTouch(new URL('https://www.yunle.fun/pricing?utm_source=zhihu&code=private#secret'), 'https://link.zhihu.com/?target=private', now)
    expect(result).toMatchObject({ landingPath: '/pricing', referrerHost: 'link.zhihu.com', utmSource: 'zhihu' })
    expect(JSON.stringify(result)).not.toMatch(/private|secret|target|code/)
    const context = readAcquisitionContext({ version: 1, firstTouch: { ...result, landingPath: '/pricing?code=private#secret', referrerHost: 'user:password@host', uid: 'forged' } }, now)
    expect(context?.firstTouch?.landingPath).toBe('/pricing')
    expect(context?.firstTouch?.referrerHost).toBe('')
    expect(JSON.stringify(context)).not.toContain('forged')
  })

  it('preserves the application acquisition through login and OAuth callback without attributing GitHub', () => {
    const first = captureAcquisitionTouch(new URL('https://cook.yunyoujun.cn/?utm_source=baidu'), 'https://www.baidu.com/', now)
    const context = { version: 1, firstTouch: first, registerTouch: first }
    const query = ssoQuery({ acquisition: JSON.stringify(context), utm_source: 'login-site' })
    const ssoPath = `/auth/sso?${query}`
    const original = captureAcquisitionEntry(new URL(ssoPath, 'https://www.yunle.fun'), '', stores, now)
    const login = captureAcquisitionEntry(new URL(`/login?${new URLSearchParams({ redirect: ssoPath, utm_source: 'login-site-override' })}`, 'https://www.yunle.fun'), '', stores, now + 1000)
    const callback = captureAcquisitionEntry(new URL('https://www.yunle.fun/auth/callback?code=secret&utm_source=callback-override'), 'https://github.com/login/oauth', stores, now + 2000)
    expect(login).toEqual(original)
    expect(callback).toEqual(original)
    expect(callback?.context?.registerTouch?.referrerHost).toBe('www.baidu.com')
  })

  it('preserves first touch across later document entries and keeps registration touch distinct', () => {
    const original = captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=zhihu'), '', stores, now)
    const returned = captureAcquisitionEntry(new URL('https://www.yunle.fun/pricing?utm_source=newsletter'), '', stores, now + 1000)
    expect(returned?.context?.firstTouch).toEqual(original?.context?.firstTouch)
    expect(returned?.context?.registerTouch?.utmSource).toBe('newsletter')
  })

  it('replaces an earlier SSO flow when a different authorization nonce carries a new source', () => {
    const makeUrl = (nonce: string, source: string) => new URL(`/auth/sso?${ssoQuery({
      nonce,
      acquisition: JSON.stringify({ version: 1, firstTouch: captureAcquisitionTouch(new URL(`https://cook.yunyoujun.cn/?utm_source=${source}`), '', now) }),
    })}`, 'https://www.yunle.fun')
    captureAcquisitionEntry(makeUrl('a'.repeat(43), 'first'), '', stores, now)
    const changed = captureAcquisitionEntry(makeUrl('b'.repeat(43), 'second'), '', stores, now + 1000)
    expect(changed?.context?.firstTouch?.utmSource).toBe('second')
  })

  it('does not reuse an abandoned application flow for a later standalone website login', () => {
    captureAcquisitionEntry(new URL(`/auth/sso?${ssoQuery()}`, 'https://www.yunle.fun'), '', stores, now)
    const website = captureAcquisitionEntry(new URL('https://www.yunle.fun/login?utm_source=newsletter'), '', stores, now + 1000)
    expect(website?.sso).toBeNull()
    expect(website?.context?.registerTouch?.utmSource).toBe('newsletter')
  })

  it('keeps upstream channels unknown for old SSO clients and rejects oversized, expired or invalid context', () => {
    const oldClient = captureAcquisitionEntry(new URL(`/auth/sso?${ssoQuery()}`, 'https://www.yunle.fun'), 'https://cook.yunyoujun.cn/', stores, now)
    expect(oldClient?.context).toBeNull()
    expect(parseAcquisitionContext('{malformed', now)).toBeNull()
    expect(parseAcquisitionContext('x'.repeat(4097), now)).toBeNull()
    expect(readAcquisitionContext({ version: 1, firstTouch: { capturedAt: now - 31 * 86400000 } }, now)).toBeNull()
    expect(captureAcquisitionTouch(new URL('https://www.yunle.fun/login'), 'https://cms.yunle.fun/', now).referrerHost).toBe('')
  })

  it('updates registration touch for later website login/signup UTM while preserving first touch', () => {
    const original = captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=first'), '', stores, now)
    const login = captureAcquisitionEntry(new URL('https://www.yunle.fun/login?utm_source=second'), '', stores, now + 1000)
    const signup = captureAcquisitionEntry(new URL('https://www.yunle.fun/signup?utm_medium=social&utm_campaign=third'), '', stores, now + 2000)
    expect(login?.context?.registerTouch?.utmSource).toBe('second')
    expect(signup?.context?.registerTouch).toMatchObject({ utmSource: '', utmMedium: 'social', utmCampaign: 'third' })
    expect(signup?.context?.firstTouch).toEqual(original?.context?.firstTouch)
    const authHop = captureAcquisitionEntry(new URL('https://www.yunle.fun/login?utm_source=invalid%3Avalue'), '', stores, now + 3000, 'navigation')
    expect(authHop).toEqual(signup)
  })

  it('captures ordinary auth SPA UTM without reusing document.referrer, and preserves the initial document capture', () => {
    vi.stubGlobal('window', { location: new URL('https://www.yunle.fun/login?utm_medium=social'), localStorage: stores.local, sessionStorage: stores.session })
    vi.stubGlobal('document', { referrer: 'https://www.baidu.com/search?q=private' })
    const documentEntry = captureBrowserAcquisition()
    expect(captureBrowserAcquisition('/login?utm_medium=social')).toEqual(documentEntry)
    const navigation = captureBrowserAcquisition('/signup?utm_source=newsletter')
    expect(navigation?.context?.firstTouch?.referrerHost).toBe('www.baidu.com')
    expect(navigation?.context?.registerTouch).toMatchObject({ landingPath: '/signup', utmSource: 'newsletter', referrerHost: '' })
  })

  it('keeps a new campaign on an ordinary SPA page through a later login without UTM', () => {
    vi.stubGlobal('window', { location: new URL('https://www.yunle.fun/pricing?utm_source=first'), localStorage: stores.local, sessionStorage: stores.session })
    vi.stubGlobal('document', { referrer: 'https://www.baidu.com/search?q=private' })
    const original = captureBrowserAcquisition()
    expect(captureBrowserAcquisition('/pricing?utm_source=first')).toEqual(original)
    const campaign = captureBrowserAcquisition('/pricing?utm_source=campaign')
    const login = captureBrowserAcquisition('/login')
    expect(login).toEqual(campaign)
    expect(login?.context?.firstTouch).toEqual(original?.context?.firstTouch)
    expect(login?.context?.registerTouch).toMatchObject({ landingPath: '/pricing', referrerHost: '', utmSource: 'campaign' })
  })

  it('uses the real SSO protocol readers and only recognizes complete valid requests', () => {
    const makeUrl = (overrides: Record<string, string>) => new URL(`/auth/sso?${ssoQuery(overrides)}`, 'https://www.yunle.fun')
    expect(readAcquisitionSsoRequest(makeUrl({ client_id: ' 1ab ', nonce: ` ${'a'.repeat(43)} `, redirect_uri: ' https://cook.yunyoujun.cn/auth/callback ' })))
      .toEqual({ clientId: '1ab', redirectUri: 'https://cook.yunyoujun.cn/auth/callback', nonce: 'a'.repeat(43) })
    for (const invalid of [
      { client_id: 'ab' },
      { client_id: 'abc-' },
      { client_id: 'a'.repeat(65) },
      { nonce: '' },
      { scope: '' },
      { code_challenge: '' },
      { code_challenge_method: 'plain' },
      { redirect_uri: 'https://cook.yunyoujun.cn' },
      { prompt: 'unexpected' },
      { native_callback_uri: 'https://example.com/callback', prompt: 'select_account' },
      { native_callback_uri: `yunlefun://auth/sso?state=${'n'.repeat(43)}`, prompt: 'consent' },
    ]) {
      expect(readAcquisitionSsoRequest(makeUrl(invalid))).toBeNull()
    }
    expect(readAcquisitionSsoRequest(makeUrl({ native_callback_uri: `yunlefun://auth/sso?state=${'n'.repeat(43)}`, prompt: 'select_account' }))).not.toBeNull()
  })

  it('uses only explicit SSO landing UTM when acquisition is absent or invalid, including nested login redirects', () => {
    const ssoPath = `/auth/sso?${ssoQuery({ acquisition: '{malformed', utm_source: 'newsletter', utm_medium: 'email', code: 'private-code' })}`
    const login = captureAcquisitionEntry(new URL(`/login?${new URLSearchParams({ redirect: ssoPath, utm_source: 'login-site' })}`, 'https://www.yunle.fun'), 'https://www.baidu.com/search?q=private', stores, now)
    expect(login?.sso?.clientId).toBe('cook-web')
    expect(login?.context?.firstTouch).toEqual(login?.context?.registerTouch)
    expect(login?.context?.registerTouch).toMatchObject({ landingHost: 'www.yunle.fun', landingPath: '/auth/sso', referrerHost: '', utmSource: 'newsletter', utmMedium: 'email' })
    expect(JSON.stringify(login?.context)).not.toMatch(/private|nonce|code_challenge|client_id|redirect_uri|login-site/)

    const noContext = captureAcquisitionEntry(new URL(`/auth/sso?${ssoQuery({ nonce: 'b'.repeat(43), acquisition: 'x'.repeat(4097) })}`, 'https://www.yunle.fun'), 'https://www.baidu.com/', stores, now + 1000)
    expect(noContext?.context).toBeNull()
    const mediumOnly = captureAcquisitionEntry(new URL(`/auth/sso?${ssoQuery({ nonce: 'd'.repeat(43), utm_medium: 'social' })}`, 'https://www.yunle.fun'), '', stores, now + 2000)
    expect(mediumOnly?.context?.registerTouch).toMatchObject({ utmSource: '', utmMedium: 'social', referrerHost: '' })
  })

  it('falls back to outer login/signup UTM only after validating the nested SSO flow and preferring app context', () => {
    const loginUrl = (inner: string, outer: Record<string, string> = {}) => new URL(`/login?${new URLSearchParams({ redirect: inner, utm_source: 'zhihu', ...outer })}`, 'https://www.yunle.fun')
    const initialSso = captureAcquisitionEntry(new URL(`/auth/sso?${ssoQuery()}`, 'https://www.yunle.fun'), '', stores, now - 1000)
    expect(initialSso?.context).toBeNull()
    const outer = captureAcquisitionEntry(loginUrl(`/auth/sso?${ssoQuery()}`), 'https://www.baidu.com/', stores, now)
    expect(outer?.sso?.clientId).toBe('cook-web')
    expect(outer?.context?.registerTouch).toMatchObject({ landingPath: '/login', utmSource: 'zhihu', referrerHost: '' })

    const appTouch = captureAcquisitionTouch(new URL('https://cook.yunyoujun.cn/?utm_source=app-campaign'), '', now)
    const withContext = `/auth/sso?${ssoQuery({ nonce: 'b'.repeat(43), utm_source: 'inner-campaign', acquisition: JSON.stringify({ version: 1, firstTouch: appTouch, registerTouch: appTouch }) })}`
    const context = captureAcquisitionEntry(loginUrl(withContext), '', stores, now + 1000)
    expect(context?.context?.registerTouch).toEqual(appTouch)

    const incomplete = loginUrl(`/auth/sso?${ssoQuery({ client_id: '', scope: '' })}`, { client_id: 'cook-web', scope: 'identity:bootstrap' })
    expect(readAcquisitionSsoRequest(incomplete)).toBeNull()
    expect(captureAcquisitionEntry(incomplete, '', stores, now + 2000)?.sso).toBeNull()
  })
})
