import { describe, expect, it } from 'vitest'
import { isCrossAppAuthorizationUrl } from '../../app/utils/cross-app-authorization'

const base = {
  client_id: 'life-ios',
  redirect_uri: 'https://life.yunle.fun/auth/callback',
  scope: 'identity:bootstrap',
  nonce: 'n'.repeat(43),
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
  prompt: 'select_account',
}

function url(params: Record<string, string> = base, path = '/auth/app'): string {
  return `https://www.yunle.fun${path}?${new URLSearchParams(params).toString()}`
}

describe('cross-app authorization entry', () => {
  it('accepts the registered native client with its exact callback', () => {
    expect(isCrossAppAuthorizationUrl(url())).toBe(true)
    const { prompt: _prompt, ...withoutPrompt } = base
    expect(isCrossAppAuthorizationUrl(url(withoutPrompt))).toBe(true)
  })

  it('rejects web clients, other callbacks and other paths', () => {
    expect(isCrossAppAuthorizationUrl(url({ ...base, client_id: 'cms-web' }))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url({ ...base, redirect_uri: 'https://evil.example/auth/callback' }))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url({ ...base, redirect_uri: 'https://life.yunle.fun/auth/callback/' }))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url(base, '/auth/sso'))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url().replace('https://www.', 'https://'))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url().replace('https:', 'http:'))).toBe(false)
  })

  it('rejects duplicate, extra and native callback parameters', () => {
    expect(isCrossAppAuthorizationUrl(`${url()}&nonce=${'m'.repeat(43)}`)).toBe(false)
    expect(isCrossAppAuthorizationUrl(`${url()}&native_callback_uri=yunlefun://auth/sso`)).toBe(false)
    expect(isCrossAppAuthorizationUrl(`${url()}&acquisition=x`)).toBe(false)
    expect(isCrossAppAuthorizationUrl(url({ ...base, prompt: 'none' }))).toBe(false)
  })

  it('rejects fragments, credentials, ports, missing values and oversized input', () => {
    expect(isCrossAppAuthorizationUrl(`${url()}#x`)).toBe(false)
    expect(isCrossAppAuthorizationUrl(url().replace('https://', 'https://user@'))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url().replace('www.yunle.fun', 'www.yunle.fun:8443'))).toBe(false)
    expect(isCrossAppAuthorizationUrl(url({ ...base, nonce: '' }))).toBe(false)
    expect(isCrossAppAuthorizationUrl(`${url()}${'&x'.repeat(2100)}`)).toBe(false)
  })
})
