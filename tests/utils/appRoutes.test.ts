import { describe, expect, it } from 'vitest'
import { getAppDetailPath } from '../../app/utils/appRoutes'

describe('application detail URLs', () => {
  it('gives different owners independent URLs for the same slug', () => {
    expect(getAppDetailPath({ ownerLogin: 'Alice', slug: 'sponsors' })).toBe('/u/alice/apps/sponsors')
    expect(getAppDetailPath({ ownerLogin: 'Bob', slug: 'sponsors' })).toBe('/u/bob/apps/sponsors')
  })

  it('uses an independent market short name when present', () => {
    expect(getAppDetailPath({ ownerLogin: 'Bob', slug: 'sponsors', marketShortName: 'bob-sponsors' })).toBe('/apps/bob-sponsors')
  })

  it('encodes path segments and preserves legacy references without an owner', () => {
    expect(getAppDetailPath({ ownerLogin: 'alice', slug: 'a/b?c' })).toBe('/u/alice/apps/a%2Fb%3Fc')
    expect(getAppDetailPath({ slug: 'sponsors' })).toBe('/apps/sponsors')
  })
})
