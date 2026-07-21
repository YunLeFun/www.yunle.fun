import { describe, expect, it } from 'vitest'
import { getCanonicalRedirect } from '../../server/middleware/canonical-host'

describe('canonical host redirect', () => {
  it('redirects the apex host while preserving path and query', () => {
    const location = getCanonicalRedirect(
      'yunle.fun:443',
      new URL('https://yunle.fun/apps/example?from=apex&lang=zh-CN'),
    )

    expect(location).toBe('https://www.yunle.fun/apps/example?from=apex&lang=zh-CN')
  })

  it('accepts the first forwarded host and a trailing dot', () => {
    const location = getCanonicalRedirect(
      'YUNLE.FUN., edgeone-origin.example',
      new URL('https://yunle.fun/'),
    )

    expect(location).toBe('https://www.yunle.fun/')
  })

  it('does not redirect the canonical or unrelated hosts', () => {
    const url = new URL('https://www.yunle.fun/pricing')

    expect(getCanonicalRedirect('www.yunle.fun', url)).toBeNull()
    expect(getCanonicalRedirect('api.yunle.fun', url)).toBeNull()
  })
})
