// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import HeaderAuthArea from '../../app/components/HeaderAuthArea.vue'

const h = vi.hoisted(() => ({
  s: {} as Record<string, any>,
}))

mockNuxtImport('preloadComponents', () => (...args: unknown[]) => h.s.preloadComponents(...args))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.s.auth,
}))

const globalStubs = {
  UButton: {
    props: ['label'],
    template: '<button type="button"><slot>{{ label }}</slot></button>',
  },
  HeaderAuthSkeleton: {
    template: '<div data-testid="header-auth-skeleton" />',
  },
  LazyNotificationBell: {
    template: '<button data-testid="notification-bell" />',
  },
  NotificationBell: {
    template: '<button data-testid="notification-bell" />',
  },
  LazyUserMenu: {
    template: '<div data-testid="user-menu">user menu</div>',
  },
  UserMenu: {
    template: '<div data-testid="user-menu">user menu</div>',
  },
  UserMenuSkeleton: {
    template: '<div data-testid="user-menu-skeleton" />',
  },
}

describe('headerAuthArea', () => {
  beforeEach(() => {
    h.s.authReady = ref(false)
    h.s.isAuthenticated = ref(false)
    h.s.checkAuthStatus = vi.fn(async () => {
      h.s.authReady.value = true
    })
    h.s.preloadComponents = vi.fn().mockResolvedValue(undefined)
    h.s.auth = {
      authReady: h.s.authReady,
      checkAuthStatus: h.s.checkAuthStatus,
      isAuthenticated: h.s.isAuthenticated,
    }

    useState<boolean>('header_auth_area_ready', () => false).value = false
    useState<boolean>('header_auth_area_preparing', () => false).value = false
    useState<{ id?: string } | null>('auth_user', () => null).value = null
  })

  it('keeps the complete auth skeleton visible while checking the session', async () => {
    let resolveAuthCheck!: () => void
    h.s.checkAuthStatus.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveAuthCheck = () => {
        h.s.authReady.value = true
        resolve()
      }
    }))

    const wrapper = await mountSuspended(HeaderAuthArea, {
      global: { stubs: globalStubs },
    })
    await nextTick()

    expect(wrapper.text()).not.toContain('登录')
    expect(wrapper.find('[data-testid="header-auth-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="notification-bell"]').exists()).toBe(false)

    await flushPromises()
    expect(h.s.checkAuthStatus).toHaveBeenCalledTimes(1)

    resolveAuthCheck()
    await flushPromises()
    await nextTick()

    expect(h.s.preloadComponents).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('登录')
    expect(wrapper.find('[data-testid="header-auth-skeleton"]').exists()).toBe(false)
  })

  it('switches atomically to the fixed authenticated slot after authentication', async () => {
    h.s.checkAuthStatus.mockImplementationOnce(async () => {
      h.s.authReady.value = true
      h.s.isAuthenticated.value = true
      useState<{ id: string } | null>('auth_user').value = { id: 'user-1' }
    })

    const wrapper = await mountSuspended(HeaderAuthArea, {
      global: { stubs: globalStubs },
    })

    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(h.s.checkAuthStatus).toHaveBeenCalledTimes(1)
    expect(h.s.preloadComponents).toHaveBeenCalledWith('UserMenu')
    expect(wrapper.find('[data-testid="notification-bell"]').exists()).toBe(true)
    expect(
      wrapper.find('[data-testid="user-menu"]').exists()
      || wrapper.find('[data-testid="user-menu-skeleton"]').exists(),
    ).toBe(true)
    expect(useState<boolean>('header_auth_area_ready').value).toBe(true)
  })

  it('switches to authenticated controls when a guest logs in after mount', async () => {
    const wrapper = await mountSuspended(HeaderAuthArea, {
      global: { stubs: globalStubs },
    })
    await flushPromises()
    await nextTick()

    expect(wrapper.text()).toContain('登录')

    h.s.isAuthenticated.value = true
    useState<{ id: string } | null>('auth_user').value = { id: 'user-1' }
    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(h.s.preloadComponents).toHaveBeenCalledWith('UserMenu')
    expect(wrapper.find('[data-testid="notification-bell"]').exists()).toBe(true)
    expect(
      wrapper.find('[data-testid="user-menu"]').exists()
      || wrapper.find('[data-testid="user-menu-skeleton"]').exists(),
    ).toBe(true)
  })
})
