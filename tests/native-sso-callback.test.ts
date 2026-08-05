import { describe, expect, it } from 'vitest'
import {
  buildNativeSsoCallbackUrl,
  readNativeSsoCallbackUri,
} from '../app/utils/native-sso-callback'

const state = 's'.repeat(43)

describe('native SSO callback transport', () => {
  it('wraps an HTTPS authorization result for the exact mobile callback', () => {
    const callback = readNativeSsoCallbackUri(
      `yunlefun://auth/sso?state=${state}`,
    )
    expect(callback).toBe(`yunlefun://auth/sso?state=${state}`)

    const resultUrl = `https://cms.yunle.fun/#ylf_sso=${'r'.repeat(120)}`
    const wrapped = new URL(buildNativeSsoCallbackUrl(callback!, resultUrl))
    expect(wrapped.protocol).toBe('yunlefun:')
    expect(wrapped.hostname).toBe('auth')
    expect(wrapped.pathname).toBe('/sso')
    expect(wrapped.searchParams.get('state')).toBe(state)
    expect(wrapped.searchParams.get('result')).toBe(resultUrl)
  })

  it.each([
    `https://apps.yunle.fun/auth/sso?state=${state}`,
    `yunlefun://evil/sso?state=${state}`,
    `yunlefun://auth/other?state=${state}`,
    'yunlefun://auth/sso?state=short',
    `yunlefun://auth/sso?state=${state}&next=https://evil.example`,
  ])('rejects an unregistered native callback: %s', (value) => {
    expect(readNativeSsoCallbackUri(value)).toBeNull()
  })
})
