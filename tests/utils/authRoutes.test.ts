import { describe, expect, it } from 'vitest'
import { isPublicAuthRoute } from '../../app/utils/authRoutes'

describe('public authentication routes', () => {
  it('keeps the application atlas public without widening protected routes', () => {
    expect(isPublicAuthRoute('/explore')).toBe(true)
    expect(isPublicAuthRoute('/download')).toBe(true)
    expect(isPublicAuthRoute('/explore/private')).toBe(false)
    expect(isPublicAuthRoute('/wallet')).toBe(false)
  })
})
