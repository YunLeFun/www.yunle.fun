import { describe, expect, it } from 'vitest'
import {
  getSafeLoginRedirect,
  hasPersistedCloudbaseCredentials,
  isPublicAuthRoute,
  resolveAuthRestorationState,
  shouldRestoreAuthOnRoute,
} from '../../app/utils/authRoutes'

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

  it('skips the auth SDK only for anonymous public navigation', () => {
    expect(shouldRestoreAuthOnRoute('/', false)).toBe(false)
    expect(shouldRestoreAuthOnRoute('/', true)).toBe(true)
    expect(shouldRestoreAuthOnRoute('/wallet', false)).toBe(true)
  })

  it('keeps cookie-only sessions pending until the server session is ready', () => {
    expect(resolveAuthRestorationState({
      cookieSessionEnabled: true,
      hasCurrentUser: false,
      hasPersistedCredentials: false,
      serverSessionLoggedIn: false,
      serverSessionReady: false,
    })).toBe('pending')

    expect(resolveAuthRestorationState({
      cookieSessionEnabled: true,
      hasCurrentUser: false,
      hasPersistedCredentials: false,
      serverSessionLoggedIn: true,
      serverSessionReady: true,
    })).toBe('restorable')

    expect(resolveAuthRestorationState({
      cookieSessionEnabled: true,
      hasCurrentUser: false,
      hasPersistedCredentials: false,
      serverSessionLoggedIn: false,
      serverSessionReady: true,
    })).toBe('anonymous')
  })

  it('detects the CloudBase credential key without parsing session contents', () => {
    const storage = {
      getItem: (key: string) => key === 'credentials_yunlefun' ? '{}' : null,
    }

    expect(hasPersistedCloudbaseCredentials('yunlefun', storage)).toBe(true)
    expect(hasPersistedCloudbaseCredentials('other-env', storage)).toBe(false)
    expect(hasPersistedCloudbaseCredentials('', storage)).toBe(false)
  })

  it('treats inaccessible browser storage as an anonymous session hint', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(hasPersistedCloudbaseCredentials('yunlefun', storage)).toBe(false)
  })
})
