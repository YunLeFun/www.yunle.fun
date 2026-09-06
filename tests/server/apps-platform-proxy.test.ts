import type { AppRecord, WorkshopPublicInfo } from '../../app/types/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fetchAppsPlatform: vi.fn(),
  requireAccessToken: vi.fn(),
  disableCaching: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.stubGlobal('defineEventHandler', (handler: (event: unknown) => unknown) => handler)
vi.stubGlobal('getQuery', (event: { query: Record<string, string> }) => event.query)
vi.stubGlobal('getRouterParam', (event: { params: Record<string, string> }, key: string) => event.params[key])
vi.stubGlobal('createError', (input: { statusCode: number, message?: string }) =>
  Object.assign(new Error(input.message), input))
vi.stubGlobal('setResponseHeader', h.setResponseHeader)
vi.stubGlobal('disableSessionResponseCaching', h.disableCaching)
vi.stubGlobal('requireAppsPlatformAccessToken', h.requireAccessToken)
vi.stubGlobal('fetchAppsPlatform', h.fetchAppsPlatform)

const { default: personalHandler } = await import('../../server/api/apps-platform/personal.get')
const { default: mineHandler } = await import('../../server/api/apps-platform/mine.get')
const { default: workshopsHandler } = await import('../../server/api/apps-platform/workshops.get')

const publicApp: AppRecord = {
  _id: 'public-app',
  ownerLogin: 'alice',
  name: '主页应用',
  slug: 'home-app',
  isPublic: true,
  audience: 'public',
  createdAt: 1,
  updatedAt: 2,
}

const privateApp: AppRecord = {
  _id: 'private-app',
  ownerLogin: 'alice',
  name: '坊客应用',
  slug: 'workshop-app',
  isPublic: false,
  audience: 'workshop',
  createdAt: 1,
  updatedAt: 2,
}

const ownedWorkshop: WorkshopPublicInfo & { ownerUid: string } = {
  _id: '7KM2QX',
  ownerUid: 'owner-1',
  ownerName: 'Alice',
  name: 'Alice 的私人工坊',
  joinPolicy: 'approval',
  status: 'active',
}

const joinedWorkshop: WorkshopPublicInfo = {
  _id: '8NP3RY',
  ownerName: 'Bob',
  name: 'Bob 的私人工坊',
  joinPolicy: 'open',
  status: 'active',
}

describe('apps platform read proxies', () => {
  beforeEach(() => {
    h.fetchAppsPlatform.mockReset()
    h.requireAccessToken.mockReset().mockResolvedValue('viewer-token')
    h.disableCaching.mockReset()
    h.setResponseHeader.mockReset()
  })

  it('loads a public personal-home projection without forwarding private credentials', async () => {
    h.fetchAppsPlatform.mockResolvedValue({
      ownerLogin: 'alice',
      items: [publicApp],
    })

    await expect(personalHandler({ query: { login: 'alice' } } as never)).resolves.toEqual({
      ownerLogin: 'alice',
      items: [publicApp],
    })
    expect(h.fetchAppsPlatform).toHaveBeenCalledWith(
      expect.anything(),
      '/api/markets/personal/alice',
    )
    expect(h.setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      'cache-control',
      'no-store',
    )
  })

  it('recovers historical owner-login casing from the public catalog only', async () => {
    h.fetchAppsPlatform.mockImplementation((_event: unknown, path: string) => {
      if (path === '/api/markets/personal/yunyoujun')
        throw Object.assign(new Error('not found'), { statusCode: 404 })
      if (path === '/api/apps/public')
        return { items: [{ ...publicApp, ownerLogin: 'YunYouJun' }] }
      if (path === '/api/markets/personal/YunYouJun') {
        return {
          ownerLogin: 'YunYouJun',
          items: [{ ...publicApp, ownerLogin: 'YunYouJun' }],
        }
      }
      throw new Error(`unexpected path ${path}`)
    })

    await expect(personalHandler({ query: { login: 'yunyoujun' } } as never)).resolves.toMatchObject({
      ownerLogin: 'YunYouJun',
      items: [{ name: '主页应用' }],
    })
    expect(h.fetchAppsPlatform.mock.calls.map(call => call[1])).toEqual([
      '/api/markets/personal/yunyoujun',
      '/api/apps/public',
      '/api/markets/personal/YunYouJun',
    ])
  })

  it('forwards the restored account token only for the private owner projection', async () => {
    h.fetchAppsPlatform.mockResolvedValue({ items: [privateApp] })

    await expect(mineHandler({} as never)).resolves.toEqual({ items: [privateApp] })
    expect(h.disableCaching).toHaveBeenCalledOnce()
    expect(h.fetchAppsPlatform).toHaveBeenCalledWith(
      expect.anything(),
      '/api/apps/mine',
      'viewer-token',
    )
  })

  it('returns only summarized membership counts and authorized workshop app views', async () => {
    h.fetchAppsPlatform.mockImplementation((_event: unknown, path: string, token?: string) => {
      expect(token).toBe('viewer-token')
      if (path === '/api/workshops/mine') {
        return {
          management: {
            workshop: ownedWorkshop,
            pending: [{ userUid: 'pending-user', private: 'not returned' }],
            guests: [{ userUid: 'guest-1' }, { userUid: 'guest-2' }],
            blocked: [{ userUid: 'blocked-user' }],
          },
        }
      }
      if (path === '/api/workshops/joined')
        return { items: [joinedWorkshop] }
      if (path === '/api/workshops/7KM2QX') {
        return {
          surface: 'workshop',
          access: 'owner',
          workshop: ownedWorkshop,
          apps: [publicApp, privateApp],
        }
      }
      if (path === '/api/workshops/8NP3RY') {
        return {
          surface: 'workshop',
          access: 'active',
          workshop: joinedWorkshop,
          apps: [privateApp],
        }
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await workshopsHandler({} as never)

    expect(result.owned).toMatchObject({
      access: 'owner',
      guestCount: 2,
      pendingCount: 1,
      apps: [publicApp, privateApp],
    })
    expect(result.joined).toEqual([{
      access: 'active',
      workshop: joinedWorkshop,
      apps: [privateApp],
    }])
    expect(JSON.stringify(result)).not.toContain('pending-user')
    expect(JSON.stringify(result)).not.toContain('blocked-user')
  })
})
