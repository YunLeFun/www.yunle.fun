// @vitest-environment nuxt
import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ProfilePage from '../../app/pages/profile.vue'

const h = vi.hoisted(() => ({
  user: undefined as unknown as Ref<Record<string, unknown> | null>,
  getMyApps: vi.fn(),
  getMyWorkshops: vi.fn(),
  getProfile: vi.fn(),
}))

mockNuxtImport('useTcbAuth', () => () => ({
  user: h.user,
  isAuthenticated: ref(true),
  loading: ref(false),
}))
mockNuxtImport('useApps', () => () => ({
  getMyApps: h.getMyApps,
  getMyWorkshops: h.getMyWorkshops,
}))
mockNuxtImport('useMembership', () => () => ({
  isActive: ref(false),
  state: ref(null),
  refresh: vi.fn(),
}))
mockNuxtImport('useCoin', () => () => ({
  balance: ref(0),
  refresh: vi.fn(),
}))
mockNuxtImport('useUserProfile', () => () => ({
  getProfile: h.getProfile,
}))
mockNuxtImport('onUserSession', () => (callback: () => void) => callback())

describe('profile home entry', () => {
  beforeEach(() => {
    h.user = ref({
      id: '2078850644063563776',
      login: null,
      nickname: '222',
      role: 'USER',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    h.getMyApps.mockReset().mockResolvedValue([])
    h.getMyWorkshops.mockReset().mockResolvedValue({ owned: null, joined: [] })
    h.getProfile.mockReset().mockResolvedValue(null)
  })

  it('links accounts without a username to their uid-based public page', async () => {
    const wrapper = await mountSuspended(ProfilePage, {
      shallow: true,
      global: {
        stubs: {
          UContainer: { template: '<main><slot /></main>' },
          SkyHero: { template: '<section><slot /></section>' },
          NuxtLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
          AppSurfaceList: {
            props: ['apps'],
            template: '<div data-testid="app-list">{{ apps.map((app) => app.name).join(",") }}</div>',
          },
        },
      },
    })
    await flushPromises()

    const homeEntry = wrapper.get('a[href="/u/2078850644063563776"]')
    expect(homeEntry.text()).toContain('我的主页')
  })

  it('shows public homepage apps and the private workshop available to the account', async () => {
    h.user.value = {
      ...h.user.value,
      login: 'alice',
    }
    h.getMyApps.mockResolvedValue([{
      _id: 'public-app',
      ownerLogin: 'alice',
      name: '主页作品',
      slug: 'home-work',
      isPublic: true,
      audience: 'public',
      publicationStatus: 'published',
      createdAt: 1,
      updatedAt: 2,
    }])
    h.getMyWorkshops.mockResolvedValue({
      owned: {
        access: 'owner',
        workshop: {
          _id: '7KM2QX',
          ownerName: 'Alice',
          name: 'Alice 的私人工坊',
          joinPolicy: 'approval',
          status: 'active',
        },
        apps: [{
          _id: 'workshop-app',
          ownerLogin: 'alice',
          name: '坊客作品',
          slug: 'private-work',
          isPublic: false,
          audience: 'workshop',
          publicationStatus: 'published',
          createdAt: 1,
          updatedAt: 2,
        }],
        guestCount: 3,
        pendingCount: 1,
      },
      joined: [],
    })

    const wrapper = await mountSuspended(ProfilePage, {
      shallow: true,
      global: {
        stubs: {
          UContainer: { template: '<main><slot /></main>' },
          SkyHero: { template: '<section><slot /></section>' },
          NuxtLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
          AppSurfaceList: {
            props: ['apps'],
            template: '<div data-testid="app-list">{{ apps.map((app) => app.name).join(",") }}</div>',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('主页作品')
    expect(wrapper.text()).toContain('Alice 的私人工坊')
    expect(wrapper.text()).toContain('坊客作品')
    expect(wrapper.text()).toContain('3 位坊客')
    expect(wrapper.text()).toContain('1 个申请待处理')
  })
})
