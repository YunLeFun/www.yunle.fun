// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import HomeAppShowcase from '../../app/components/HomeAppShowcase.vue'
import { ssoExplorerApps } from '../../app/config/sso-explorer'

const h = vi.hoisted(() => ({
  getOfficialApps: vi.fn(),
  intersectionCallback: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
  useTcbAuthSession: vi.fn(() => ({
    user: { value: null },
    authStatus: { value: 'guest' },
  })),
}))

mockNuxtImport('useApps', () => () => ({
  getOfficialApps: h.getOfficialApps,
}))

mockNuxtImport('useIntersectionObserver', () => (_target, callback) => {
  h.intersectionCallback = callback
  return { stop: vi.fn() }
})

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: h.useTcbAuthSession,
}))

describe('home app showcase', () => {
  beforeEach(() => {
    h.getOfficialApps.mockReset()
    h.useTcbAuthSession.mockClear()
    h.intersectionCallback = null
    useState<boolean>('auth_ready', () => false).value = true
    useState<Record<string, unknown> | null>('auth_user', () => null).value = null
  })

  it('renders the registry-backed SSO cloud without querying the marketplace', async () => {
    const wrapper = await mountSuspended(HomeAppShowcase)

    await flushPromises()
    await nextTick()

    expect(h.getOfficialApps).not.toHaveBeenCalled()
    expect(h.useTcbAuthSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('一个账号，连接每一朵云')
    expect(wrapper.find('[data-testid="sso-map-placeholder"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sso-account-cloud"]').exists()).toBe(false)

    h.intersectionCallback?.([{ isIntersecting: true }])
    await flushPromises()
    await nextTick()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="sso-account-cloud"]').exists()).toBe(true)
    })

    expect(wrapper.get('[data-testid="sso-account-cloud"]').attributes('href'))
      .toContain('/login?redirect=%2F')

    const appList = wrapper.get('.app-sso-cloud-map__apps')
    for (const app of ssoExplorerApps)
      expect(appList.get(`[data-testid="sso-app-${app.appId}"]`).exists()).toBe(true)
  })

  it('links an authenticated account cloud to the profile', async () => {
    useState<Record<string, unknown> | null>('auth_user').value = {
      id: 'user-1',
      nickname: '云游君',
      login: 'yunyoujun',
      avatar: null,
    }

    const wrapper = await mountSuspended(HomeAppShowcase)
    h.intersectionCallback?.([{ isIntersecting: true }])
    await flushPromises()
    await nextTick()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="sso-account-cloud"]').exists()).toBe(true)
    })

    expect(wrapper.get('[data-testid="sso-account-cloud"]').attributes('href')).toContain('/profile')
    expect(wrapper.get('[data-testid="sso-account-cloud"]').text()).toContain('云游君')
  })
})
