// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import DeferredUserMenu from '../../app/components/DeferredUserMenu.vue'

const h = vi.hoisted(() => ({
  s: {} as Record<string, any>,
}))

mockNuxtImport('useRoute', () => () => h.s.route)
mockNuxtImport('preloadComponents', () => (...args: unknown[]) => h.s.preloadComponents(...args))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.s.auth,
}))

const globalStubs = {
  UButton: {
    props: ['label'],
    template: '<button type="button"><slot>{{ label }}</slot></button>',
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

describe('deferredUserMenu', () => {
  beforeEach(() => {
    h.s.route = reactive({ path: '/' })
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

    useState<boolean>('deferred_user_menu_ready', () => false).value = false
    useState<boolean>('deferred_user_menu_preparing', () => false).value = false
    useState<{ id?: string } | null>('auth_user', () => null).value = null
  })

  it('shows a skeleton while checking auth instead of flashing login actions', async () => {
    let resolveAuthCheck!: () => void
    h.s.checkAuthStatus.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveAuthCheck = () => {
        h.s.authReady.value = true
        resolve()
      }
    }))

    const wrapper = await mountSuspended(DeferredUserMenu, {
      global: { stubs: globalStubs },
    })
    await nextTick()

    expect(wrapper.text()).not.toContain('登录')
    expect(wrapper.find('[data-testid="user-menu"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="user-menu-skeleton"]').exists()).toBe(true)

    await flushPromises()
    expect(h.s.checkAuthStatus).toHaveBeenCalledTimes(1)

    resolveAuthCheck()
    await flushPromises()
    await nextTick()

    expect(h.s.preloadComponents).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('登录')
    expect(wrapper.find('[data-testid="user-menu"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="user-menu-skeleton"]').exists()).toBe(false)
  })

  it('mounts the user menu after the initial auth check resolves as authenticated', async () => {
    h.s.checkAuthStatus.mockImplementationOnce(async () => {
      h.s.authReady.value = true
      h.s.isAuthenticated.value = true
    })

    await mountSuspended(DeferredUserMenu, {
      global: { stubs: globalStubs },
    })

    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(h.s.checkAuthStatus).toHaveBeenCalledTimes(1)
    expect(h.s.preloadComponents).toHaveBeenCalledWith('UserMenu')
    expect(useState<boolean>('deferred_user_menu_ready').value).toBe(true)
  })

  it('switches to the user menu when a guest logs in after mount', async () => {
    const wrapper = await mountSuspended(DeferredUserMenu, {
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

    expect(h.s.preloadComponents).toHaveBeenCalledWith('UserMenu')
    expect(useState<boolean>('deferred_user_menu_ready').value).toBe(true)
  })
})
