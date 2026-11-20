import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  setResponseHeader: vi.fn(),
}))

interface TestEvent {
  kind: string
  etag?: string
}

vi.stubGlobal('defineEventHandler', (handler: (event: TestEvent) => unknown) => handler)
vi.stubGlobal('getRouterParam', (event: TestEvent) => event.kind)
vi.stubGlobal('getHeader', (event: TestEvent, name: string) => name === 'if-none-match' ? event.etag : undefined)
vi.mock('#app/nuxt', () => ({ useRuntimeConfig: () => ({ publicContentApiUrl: 'https://content.example.test/' }) }))
vi.stubGlobal('createError', (input: { statusCode: number, message: string }) =>
  Object.assign(new Error(input.message), input))
vi.stubGlobal('$fetch', h.fetch)
vi.stubGlobal('setResponseHeader', h.setResponseHeader)

const { default: handler } = await import('../../server/api/public-content/[kind].get')

const published = {
  schemaVersion: 1,
  kind: 'announcements',
  releaseId: 'announcement-release',
  publishedAt: '2026-11-20T09:00:00.000Z',
  content: { items: [] },
}

describe('public content response caching', () => {
  beforeEach(() => {
    h.fetch.mockReset().mockResolvedValue(published)
    h.setResponseHeader.mockClear()
  })

  it('allows a validated release to be cached briefly at the edge', async () => {
    const event = { kind: 'announcements' }

    await expect(handler(event as never)).resolves.toEqual(published)
    expect(h.setResponseHeader).toHaveBeenCalledWith(event, 'ETag', '"announcement-release"')
    expect(h.setResponseHeader).toHaveBeenLastCalledWith(event, 'Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate')
  })

  it('retains the validator and shared cache policy on a conditional hit', async () => {
    const event = { kind: 'announcements', etag: '"announcement-release"' }

    await expect(handler(event as never)).resolves.toBeNull()
    expect(h.setResponseHeader).toHaveBeenCalledWith(event, 'ETag', '"announcement-release"')
    expect(h.setResponseHeader).toHaveBeenLastCalledWith(event, 'Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate')
  })

  it('keeps upstream failures out of the shared cache', async () => {
    h.fetch.mockRejectedValueOnce(new Error('upstream unavailable'))
    const event = { kind: 'announcements' }

    await expect(handler(event as never)).rejects.toMatchObject({ statusCode: 503 })
    expect(h.setResponseHeader).toHaveBeenCalledExactlyOnceWith(event, 'Cache-Control', 'no-store')
  })
})
