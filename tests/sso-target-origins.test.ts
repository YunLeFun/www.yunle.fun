import { describe, expect, it } from 'vitest'
import { createSsoTargetRules, isAllowedSsoTargetOrigin, LOCAL_SSO_TARGET_RULES, readSsoTargetRules } from '../app/utils/ssoTargetOrigins'

describe('sso target origin rules', () => {
  const rules = readSsoTargetRules('*.yunle.fun,https://*.yunyoujun.cn,http://localhost:2333')

  it('allows configured wildcard subdomains over HTTPS', () => {
    expect(isAllowedSsoTargetOrigin('https://wenta.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://apps.yunle.fun', rules)).toBe(true)
    expect(isAllowedSsoTargetOrigin('https://gmm.yunyoujun.cn', rules)).toBe(true)
  })

  it('does not allow apex domains or HTTP for bare wildcard rules', () => {
    expect(isAllowedSsoTargetOrigin('https://yunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://wenta.yunle.fun', rules)).toBe(false)
  })

  it('keeps exact local development origins available', () => {
    expect(isAllowedSsoTargetOrigin('http://localhost:2333', rules)).toBe(true)
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
    const productionRules = createSsoTargetRules('https://*.yunle.fun')
    const developmentRules = createSsoTargetRules('https://*.yunle.fun', { allowLocal: true })

    expect(isAllowedSsoTargetOrigin('http://localhost:8080', productionRules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('http://localhost:8080', developmentRules)).toBe(true)
  })

  it('does not match lookalike domains', () => {
    expect(isAllowedSsoTargetOrigin('https://notyunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://yunle.fun.evil.com', rules)).toBe(false)
  })
})
