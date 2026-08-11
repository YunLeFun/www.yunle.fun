import { describe, expect, it } from 'vitest'
import { getSafeLoginRedirect, isPublicAuthRoute } from '../../app/utils/authRoutes'

describe('public authentication routes', () => {
  it('keeps the application atlas public without widening protected routes', () => {
    expect(isPublicAuthRoute('/explore')).toBe(true)
    expect(isPublicAuthRoute('/download')).toBe(true)
    expect(isPublicAuthRoute('/claim')).toBe(true)
    expect(isPublicAuthRoute('/login/')).toBe(true)
    expect(isPublicAuthRoute('/auth/callback/')).toBe(true)
    expect(isPublicAuthRoute('/explore/private')).toBe(false)
    expect(isPublicAuthRoute('/wallet')).toBe(false)
  })

  it('falls back home when a login redirect loops or leaves the site', () => {
    expect(getSafeLoginRedirect('/wallet?from=login')).toBe('/wallet?from=login')
    expect(getSafeLoginRedirect('/login/')).toBe('/')
    expect(getSafeLoginRedirect('/signup')).toBe('/')
    expect(getSafeLoginRedirect('https://example.com')).toBe('/')
    expect(getSafeLoginRedirect('//example.com')).toBe('/')
    expect(getSafeLoginRedirect('////')).toBe('/')
    expect(getSafeLoginRedirect(undefined)).toBe('/')
  })
})
