import { describe, expect, it } from 'vitest'
import {
  getBoundOAuthProviderIds,
  getOAuthIdentityName,
  GITHUB_PROVIDER_ID,
  hasOAuthProvider,
  normalizeOAuthProviderId,
  WECHAT_PROVIDER_ID,
} from '../app/utils/authProviders'

describe('auth provider helpers', () => {
  it('normalizes legacy wechat ids to wx_open', () => {
    expect(normalizeOAuthProviderId('wechat')).toBe(WECHAT_PROVIDER_ID)
    expect(normalizeOAuthProviderId(WECHAT_PROVIDER_ID)).toBe(WECHAT_PROVIDER_ID)
  })

  it('treats getUserIdentities results as already bound unless bind is false', () => {
    expect(getBoundOAuthProviderIds([
      { id: GITHUB_PROVIDER_ID },
      { id: 'wechat' },
      { id: WECHAT_PROVIDER_ID, bind: false },
      { provider: GITHUB_PROVIDER_ID },
    ])).toEqual([GITHUB_PROVIDER_ID, WECHAT_PROVIDER_ID])
  })

  it('checks bound state against normalized provider ids', () => {
    expect(hasOAuthProvider(['wechat'], WECHAT_PROVIDER_ID)).toBe(true)
    expect(hasOAuthProvider([GITHUB_PROVIDER_ID], GITHUB_PROVIDER_ID)).toBe(true)
    expect(hasOAuthProvider([GITHUB_PROVIDER_ID], WECHAT_PROVIDER_ID)).toBe(false)
  })

  it('gets the login from the exact bound OAuth identity', () => {
    expect(getOAuthIdentityName([
      { id: WECHAT_PROVIDER_ID, name: '微信用户' },
      {
        id: GITHUB_PROVIDER_ID,
        name: 'GitHub',
        provider_user_name: ' RainCither ',
      },
    ], GITHUB_PROVIDER_ID)).toBe('RainCither')

    expect(getOAuthIdentityName([
      { id: GITHUB_PROVIDER_ID, name: 'disabled-user', bind: false },
      { id: WECHAT_PROVIDER_ID, name: 'not-github' },
    ], GITHUB_PROVIDER_ID)).toBe('')
  })

  it('falls back to the provider name when no provider username is available', () => {
    expect(getOAuthIdentityName([
      { id: GITHUB_PROVIDER_ID, name: ' RainCither ' },
    ], GITHUB_PROVIDER_ID)).toBe('RainCither')
  })
})
