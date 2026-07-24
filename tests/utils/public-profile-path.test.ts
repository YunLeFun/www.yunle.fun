import { describe, expect, it } from 'vitest'
import { getPublicProfilePath } from '../../app/utils/publicProfilePath'

describe('getPublicProfilePath', () => {
  it('falls back to the immutable user id when the account has no username', () => {
    expect(getPublicProfilePath({
      id: '2078850644063563776',
      login: null,
    }, null)).toBe('/u/2078850644063563776')
  })

  it('prefers the loaded public profile identity over stale session metadata', () => {
    expect(getPublicProfilePath({
      id: '2078850644063563776',
      login: 'stale-login',
    }, {
      userId: '2078850644063563776',
      login: null,
    })).toBe('/u/2078850644063563776')
  })

  it('uses the canonical public username when one exists', () => {
    expect(getPublicProfilePath({
      id: '2078850644063563776',
      login: 'YunYouJun',
    }, {
      userId: '2078850644063563776',
      login: 'yunyoujun',
    })).toBe('/u/yunyoujun')
  })
})
