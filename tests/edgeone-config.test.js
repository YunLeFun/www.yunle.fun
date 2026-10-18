import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../edgeone.json', import.meta.url), 'utf8'))
const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('edgeOne production configuration', () => {
  it('uses the Nuxt full-stack build in bounded regions', () => {
    expect(config.buildCommand).toBe('pnpm build')
    expect(config.nodeVersion).toBe('22.17.1')
    expect(config.cloudFunctions).toEqual({
      mainlandRegions: ['ap-shanghai'],
      overseasRegions: ['ap-singapore'],
      nodejs: { maxDuration: 30 },
    })
  })

  it('sets baseline transport and browser isolation headers', () => {
    const baselineRule = config.headers.find(rule => rule.source === '/*')
    const headers = Object.fromEntries(baselineRule.headers.map(header => [header.key, header.value]))
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBeUndefined()
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(headers['Content-Security-Policy']).toContain('default-src \'self\'')
    expect(headers['Content-Security-Policy']).toContain('frame-ancestors \'none\'')
    expect(headers['Content-Security-Policy']).toContain('object-src \'none\'')
    expect(headers['Content-Security-Policy']).toContain('https://*.api.tcloudbasegateway.com')
    expect(headers['Content-Security-Policy']).not.toContain('fonts.loli.net')
    expect(headers['Content-Security-Policy']).not.toContain('gstatic.loli.net')
  })

  it('prevents claim links from leaking referrer context', () => {
    const claimRule = config.headers.find(rule => rule.source === '/claim')
    const headers = Object.fromEntries(claimRule.headers.map(header => [header.key, header.value]))

    expect(config.headers.indexOf(claimRule)).toBeLessThan(config.headers.findIndex(rule => rule.source === '/*'))
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['Content-Security-Policy']).toContain('frame-ancestors \'none\'')
  })

  it('prevents SSO authorization parameters from leaking through referrers or caches', () => {
    const ssoRule = config.headers.find(rule => rule.source === '/auth/sso')
    const headers = Object.fromEntries(ssoRule.headers.map(header => [header.key, header.value]))

    expect(config.headers.indexOf(ssoRule)).toBeLessThan(config.headers.findIndex(rule => rule.source === '/*'))
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['Content-Security-Policy']).toContain('frame-ancestors \'none\'')
  })

  it('protects OAuth callback query parameters before the baseline static rule', () => {
    const callbackRule = config.headers.find(rule => rule.source === '/auth/callback')
    const headers = Object.fromEntries(callbackRule.headers.map(header => [header.key, header.value]))

    expect(config.headers.indexOf(callbackRule)).toBeLessThan(config.headers.findIndex(rule => rule.source === '/*'))
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['Content-Security-Policy']).toContain('frame-ancestors \'none\'')
  })

  it('serves shared web credentials to the native Yunle app as JSON', () => {
    const aasaRule = config.headers.find(rule => rule.source === '/.well-known/apple-app-site-association')
    const headers = Object.fromEntries(aasaRule.headers.map(header => [header.key, header.value]))
    const aasa = JSON.parse(readFileSync(new URL('../public/.well-known/apple-app-site-association', import.meta.url), 'utf8'))

    expect(config.headers.indexOf(aasaRule)).toBeLessThan(config.headers.findIndex(rule => rule.source === '/*'))
    expect(headers['Content-Type']).toBe('application/json')
    // 只认领跨 App 授权入口；/auth/sso 等其他 www.yunle.fun 地址必须继续在浏览器中打开。
    const appIDs = ['QT792GAY4C.fun.yunle.apps', 'QT792GAY4C.fun.yunle.apps.native-dev']
    expect(aasa.webcredentials).toEqual({ apps: appIDs })
    expect(aasa.applinks.details).toHaveLength(1)
    expect(aasa.applinks.details[0].appIDs).toEqual(appIDs)
    expect(aasa.applinks.details[0].components.map(component => component['/'])).toEqual(['/auth/app'])
    expect(JSON.stringify(aasa)).not.toContain('/auth/sso')
  })

  it('serves /auth/app with the same security headers as /auth/sso', () => {
    const sso = config.headers.find(rule => rule.source === '/auth/sso')
    const app = config.headers.find(rule => rule.source === '/auth/app')
    expect(app?.headers).toEqual(sso.headers)
  })

  it('permanently redirects the apex domain to www', () => {
    expect(config.redirects).toContainEqual({
      source: '$host',
      destination: '$wwwhost',
      statusCode: 301,
    })
  })

  it('pins the Linux OXC build chain required by EdgeOne', () => {
    expect(packageManifest.devDependencies).toMatchObject({
      '@oxc-minify/binding-linux-x64-gnu': 'catalog:',
      '@oxc-parser/binding-linux-x64-gnu': 'catalog:',
      '@oxc-transform/binding-linux-x64-gnu': 'catalog:',
      'oxc-parser': 'catalog:',
    })
  })
})
