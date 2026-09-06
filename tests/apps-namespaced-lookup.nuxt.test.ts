// @vitest-environment nuxt
import type { AppRecord } from '../app/types/app'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApps } from '../app/composables/useApps'

const { requestFetch, currentUser } = vi.hoisted(() => ({ requestFetch: vi.fn(), currentUser: { value: null as { id: string, login: string } | null } }))
mockNuxtImport('useCloudbase', () => () => ({ app: null, auth: { getSession: async () => ({ data: { session: { access_token: 'test-owner-token' } } }) } }))
mockNuxtImport('useTcbAuth', () => () => ({ user: currentUser }))
mockNuxtImport('useRequestFetch', () => () => requestFetch)
function app(ownerLogin: string, isPublic = true): AppRecord {
  return {
    _id: `${ownerLogin}-sponsors`,
    ownerLogin,
    slug: 'sponsors',
    name: 'Sponsors',
    isPublic,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('namespaced application lookup', () => {
  beforeEach(() => {
    requestFetch.mockReset()
    currentUser.value = null
  })

  it('resolves the same slug within the requested owner, including historical casing', async () => {
    requestFetch.mockResolvedValue({ items: [app('Bob'), app('Alice')] })
    await expect(useApps().getAppBySlug('sponsors', 'alice')).resolves.toEqual(app('Alice'))
    expect(requestFetch).toHaveBeenCalledWith('/api/apps-platform/personal', { query: { login: 'alice' } })
  })

  it('never falls back to another owner or exposes a private app', async () => {
    requestFetch.mockResolvedValue({ items: [app('Bob'), app('Alice', false)] })
    await expect(useApps().getAppBySlug('sponsors', 'alice')).resolves.toBeNull()
    expect(requestFetch).toHaveBeenCalledTimes(1)
  })

  it('treats a missing owner as not found and preserves upstream failures', async () => {
    requestFetch.mockRejectedValueOnce({ statusCode: 404 })
    await expect(useApps().getAppBySlug('sponsors', 'missing')).resolves.toBeNull()
    requestFetch.mockRejectedValueOnce({ statusCode: 503 })
    await expect(useApps().getAppBySlug('sponsors', 'alice')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('reads private metadata only through the authenticated owner API', async () => {
    currentUser.value = { id: 'alice-id', login: 'Alice' }
    requestFetch.mockResolvedValue({ items: [app('Alice', false)] })
    await expect(useApps().getAppBySlug('sponsors', 'alice')).resolves.toEqual(app('Alice', false))
    expect(requestFetch).toHaveBeenCalledWith('/api/apps-platform/mine', { headers: { Authorization: 'Bearer test-owner-token' } })
  })

  it('keeps old slug references resolvable for canonical redirects', async () => {
    requestFetch.mockResolvedValue({ app: app('Alice') })
    await expect(useApps().getAppBySlug('sponsors')).resolves.toEqual(app('Alice'))
    expect(requestFetch).toHaveBeenCalledWith('/api/apps-platform/public/sponsors')
  })
})
