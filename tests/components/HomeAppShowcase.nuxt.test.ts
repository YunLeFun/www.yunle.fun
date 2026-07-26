// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import HomeAppShowcase from '../../app/components/HomeAppShowcase.vue'
import { ssoExplorerApps } from '../../app/config/sso-explorer'

const h = vi.hoisted(() => ({
  getOfficialApps: vi.fn(),
  auth: {} as Record<string, unknown>,
}))

mockNuxtImport('useApps', () => () => ({
  getOfficialApps: h.getOfficialApps,
}))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.auth,
}))

describe('home app showcase', () => {
  beforeEach(() => {
    h.getOfficialApps.mockReset()
    h.auth = {
      user: ref(null),
      authStatus: ref('guest'),
    }
  })

  it('renders the registry-backed SSO cloud without querying the marketplace', async () => {
    const wrapper = await mountSuspended(HomeAppShowcase)

    await flushPromises()
    await nextTick()

    expect(h.getOfficialApps).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('一个账号，连接每一朵云')
    expect(wrapper.get('[data-testid="sso-account-cloud"]').attributes('href'))
      .toContain('/login?redirect=%2F')

    const desktop = wrapper.get('.app-sso-cloud-map__desktop')
    for (const app of ssoExplorerApps)
      expect(desktop.get(`[data-testid="sso-app-${app.appId}"]`).exists()).toBe(true)
  })

  it('links an authenticated account cloud to the profile', async () => {
    h.auth = {
      user: ref({
        nickname: '云游君',
        login: 'yunyoujun',
        avatar: null,
      }),
      authStatus: ref('authenticated'),
    }

    const wrapper = await mountSuspended(HomeAppShowcase)
    await nextTick()

    expect(wrapper.get('[data-testid="sso-account-cloud"]').attributes('href')).toContain('/profile')
    expect(wrapper.get('[data-testid="sso-account-cloud"]').text()).toContain('云游君')
  })
})
