import { describe, expect, it } from 'vitest'
import {
  getBoundOAuthProviderIds,
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
})
