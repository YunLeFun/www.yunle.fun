import { describe, expect, it } from 'vitest'
import { isAllowedSsoTargetOrigin, readSsoTargetRules } from '../app/utils/ssoTargetOrigins'

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

  it('does not match lookalike domains', () => {
    expect(isAllowedSsoTargetOrigin('https://notyunle.fun', rules)).toBe(false)
    expect(isAllowedSsoTargetOrigin('https://yunle.fun.evil.com', rules)).toBe(false)
  })
})
