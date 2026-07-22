import type { UserProfile } from '../../app/types/social'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upstreamFetch: vi.fn(),
  accountApiHttpUrl: 'https://api.example.test/account-api',
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    accountApiHttpUrl: h.accountApiHttpUrl,
  }),
}))
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: () => ({
    accountApiHttpUrl: h.accountApiHttpUrl,
  }),
}))

vi.stubGlobal('defineEventHandler', (handler: (event: unknown) => unknown) => handler)
vi.stubGlobal('getQuery', (event: { query: Record<string, string> }) => event.query)
vi.stubGlobal('createError', (input: { statusCode: number, message?: string, statusMessage?: string, cause?: unknown }) => {
  return Object.assign(new Error(input.message ?? input.statusMessage), input)
})
vi.stubGlobal('$fetch', h.upstreamFetch)

const { default: profileHandler } = await import('../../server/api/profile.get')

const profile: UserProfile = {
  userId: '2078850644063563776',
  login: null,
  nickname: 'raincither',
  avatar: null,
  description: '',
  followersCount: 0,
  followingCount: 1,
  hideFollowers: false,
  hideFollowing: false,
  notifyOnFollow: true,
  isMember: false,
}

describe('get /api/profile', () => {
  beforeEach(() => {
    h.upstreamFetch.mockReset()
    h.accountApiHttpUrl = 'https://api.example.test/account-api'
  })

  it('returns a public profile for a numeric route identifier', async () => {
    h.upstreamFetch.mockResolvedValue(profile)

    await expect(profileHandler({ query: { identifier: profile.userId } } as never)).resolves.toEqual(profile)
    expect(h.upstreamFetch).toHaveBeenCalledWith('https://api.example.test/account-api', {
      method: 'POST',
      body: { action: 'getProfile', userId: profile.userId },
      timeout: 5_000,
      retry: 1,
    })
  })

  it('falls back from a valid login-shaped identifier to the immutable user id', async () => {
    const loginShapedProfile = { ...profile, userId: 'alice', login: null }
    h.upstreamFetch.mockResolvedValueOnce(null).mockResolvedValueOnce(loginShapedProfile)

    await expect(profileHandler({ query: { identifier: 'alice' } } as never)).resolves.toEqual(loginShapedProfile)
    expect(h.upstreamFetch).toHaveBeenNthCalledWith(1, h.accountApiHttpUrl, expect.objectContaining({
      body: { action: 'getProfile', login: 'alice' },
    }))
    expect(h.upstreamFetch).toHaveBeenNthCalledWith(2, h.accountApiHttpUrl, expect.objectContaining({
      body: { action: 'getProfile', userId: 'alice' },
    }))
  })

  it('returns 404 only after the upstream definitively reports no profile', async () => {
    h.upstreamFetch.mockResolvedValue(null)

    await expect(profileHandler({ query: { identifier: profile.userId } } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('reports a retryable gateway error instead of disguising an upstream failure as not found', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.upstreamFetch.mockRejectedValue(new Error('upstream offline'))

    await expect(profileHandler({ query: { identifier: profile.userId } } as never)).rejects.toMatchObject({
      statusCode: 502,
    })
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('fails fast with 503 when the server endpoint is not configured', async () => {
    h.accountApiHttpUrl = ''

    await expect(profileHandler({ query: { identifier: profile.userId } } as never)).rejects.toMatchObject({
      statusCode: 503,
    })
    expect(h.upstreamFetch).not.toHaveBeenCalled()
  })
})
