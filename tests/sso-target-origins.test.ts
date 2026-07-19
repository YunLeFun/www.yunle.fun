import { describe, expect, it } from 'vitest'
import { createSsoTargetRules, isAllowedSsoTargetOrigin, LOCAL_SSO_TARGET_RULES, readSsoTargetRules } from '../app/utils/ssoTargetOrigins'

describe('sso target origin rules', () => {
  const rules = readSsoTargetRules('https://*.yunle.fun,https://gmm.yunyoujun.cn,https://zero-echo.advjs.org,https://preview.advjs.org,http://localhost:2333')

  it('allows registered HTTPS origins and YunLeFun subdomains', () => {
    expect(isAllowedSsoTargetOrigin('https://wenta.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://apps.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://cms.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://preview.cms.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://gmm.yunyoujun.cn', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://zero-echo.advjs.org', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://preview.advjs.org', rules)).toBe(true)
  })

  it('does not allow apex, lookalike, port-qualified, or HTTP origins', () => {
    expect(isAllowedSsoTargetOrigin('https://yunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://advjs.org', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://wenta.yunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://zero-echo.advjs.org', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://zero-echo.advjs.org:8443', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://cms.yunle.fun:8443', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://cms.yunle.fun.', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://cms.yunle.fun/path', rules)).toBe(false)
    expect(readSsoTargetRules('*.advjs.org')).toEqual([])
  })

  it('does not accept HTTP origins from production configuration', () => {
    expect(isAllowedSsoTargetOrigin('http://localhost:2333', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://localhost:5173', rules)).toBe(false)
  })

  it('allows HTTP loopback origins on any local dev server port', () => {
    const localRules = [...LOCAL_SSO_TARGET_RULES]

    expect(isAllowedSsoTargetOrigin('http://localhost:5173', localRules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('http://localhost:8080', localRules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('http://127.0.0.1:8080', localRules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('http://127.42.0.1:65535', localRules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('http://[::1]:8080', localRules)).toBe(true)
  })

  it('does not treat non-loopback local-network origins as dev origins', () => {
    const localRules = [...LOCAL_SSO_TARGET_RULES]

    expect(isAllowedSsoTargetOrigin('http://192.168.1.2:8080', localRules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://0.0.0.0:8080', localRules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://localhost:8080', localRules)).toBe(false)
  })

  it('only includes loopback dev rules when explicitly enabled', () => {
    const productionRules = createSsoTargetRules('https://drive.yunle.fun')
    const developmentRules = createSsoTargetRules('https://drive.yunle.fun', { allowLocal: true })

    expect(isAllowedSsoTargetOrigin('http://localhost:8080', productionRules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://localhost:8080', developmentRules)).toBe(true)
  })

  it('does not match lookalike domains', () => {
    expect(isAllowedSsoTargetOrigin('https://notyunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://yunle.fun.evil.com', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://notadvjs.org', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://advjs.org.evil.com', rules)).toBe(false)
  })

  it('rejects unsafe wildcard rules', () => {
    expect(readSsoTargetRules('https://*.localhost')).toEqual([])
    expect(readSsoTargetRules('https://*.yunle.fun:8443')).toEqual([])
    expect(readSsoTargetRules('https://*.*.yunle.fun')).toEqual([])
    expect(readSsoTargetRules('http://*.yunle.fun')).toEqual([])
  })
})
