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
  getProfile: vi.fn(),
}))

mockNuxtImport('useTcbAuth', () => () => ({
  user: h.user,
  isAuthenticated: ref(true),
  loading: ref(false),
}))
mockNuxtImport('useApps', () => () => ({
  getMyApps: h.getMyApps,
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
        },
      },
    })
    await flushPromises()

    const homeEntry = wrapper.get('a[href="/u/2078850644063563776"]')
    expect(homeEntry.text()).toContain('我的主页')
  })
})
