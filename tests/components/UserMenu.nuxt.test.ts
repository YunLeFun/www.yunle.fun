// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import UserMenu from '../../app/components/UserMenu.vue'

const h = vi.hoisted(() => ({
  s: {} as Record<string, any>,
}))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useMediaQuery: () => h.s.isDesktop,
  }
})

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.s.auth,
}))

mockNuxtImport('useCoin', () => () => h.s.coin)

const globalStubs = {
  MemberAvatar: {
    props: ['alt'],
    template: '<span data-testid="trigger-avatar">{{ alt }}</span>',
  },
  UIcon: {
    template: '<span aria-hidden="true" />',
  },
  UPopover: {
    props: ['open'],
    emits: ['update:open'],
    template: `
      <div data-testid="popover">
        <button data-testid="simulate-popover-outside-close" @pointerdown="$emit('update:open', false)" />
        <slot v-if="open" name="content" />
      </div>
    `,
  },
  UDrawer: {
    props: ['open'],
    emits: ['update:open'],
    template: `
      <div data-testid="drawer">
        <div data-testid="drawer-trigger" @click="$emit('update:open', !open)"><slot /></div>
        <slot v-if="open" name="content" />
      </div>
    `,
  },
  UserAccountPanel: {
    emits: ['close', 'logout'],
    template: `
      <div data-testid="stub-account-panel">
        <button data-testid="stub-logout" @click="$emit('logout')" />
      </div>
    `,
  },
  UserMenuSkeleton: {
    template: '<div data-testid="user-menu-skeleton" />',
  },
  AuthActionButtons: {
    template: '<div data-testid="auth-action-buttons" />',
  },
}

describe('userMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.s.isDesktop = ref(true)
    h.s.user = ref({
      id: 'user-1',
      login: 'skywalker',
      nickname: '晴空旅人',
      avatar: null,
    })
    h.s.authReady = ref(true)
    h.s.checkAuthStatus = vi.fn()
    h.s.logout = vi.fn().mockResolvedValue(undefined)
    h.s.auth = {
      user: h.s.user,
      authStatus: ref('authenticated'),
      authReady: h.s.authReady,
      logout: h.s.logout,
      checkAuthStatus: h.s.checkAuthStatus,
    }
    h.s.coin = {
      account: ref({ coin: 128, membership: { isActive: true } }),
      balance: ref(128),
      isMember: ref(true),
      loading: ref(false),
      refresh: vi.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens after hover intent and closes after the safe leave delay', async () => {
    const wrapper = await mountSuspended(UserMenu, {
      global: { stubs: globalStubs },
    })
    const anchor = wrapper.get('[data-testid="desktop-user-menu-anchor"]')

    await anchor.trigger('pointerenter')
    await vi.advanceTimersByTimeAsync(149)
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)

    await anchor.trigger('pointerleave')
    await vi.advanceTimersByTimeAsync(249)
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(false)
  })

  it('keeps a click-pinned desktop panel open until the trigger is clicked again', async () => {
    const wrapper = await mountSuspended(UserMenu, {
      global: { stubs: globalStubs },
    })
    const anchor = wrapper.get('[data-testid="desktop-user-menu-anchor"]')
    const trigger = wrapper.get('[data-testid="desktop-user-menu-trigger"]')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)

    await anchor.trigger('pointerleave')
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(false)
  })

  it('does not reopen when Popover reports an outside-close before the pinned trigger click', async () => {
    const wrapper = await mountSuspended(UserMenu, {
      global: { stubs: globalStubs },
    })
    const trigger = wrapper.get('[data-testid="desktop-user-menu-trigger"]')

    await trigger.trigger('click')
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="simulate-popover-outside-close"]').trigger('pointerdown')
    await trigger.trigger('click')
    await vi.runOnlyPendingTimersAsync()
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(false)
  })

  it('uses a click-triggered drawer on mobile', async () => {
    h.s.isDesktop.value = false
    const wrapper = await mountSuspended(UserMenu, {
      global: { stubs: globalStubs },
    })

    expect(wrapper.find('[data-testid="desktop-user-menu-trigger"]').exists()).toBe(false)
    const trigger = wrapper.get('[data-testid="mobile-user-menu-trigger"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(true)
  })

  it('closes the surface before logging out', async () => {
    const wrapper = await mountSuspended(UserMenu, {
      global: { stubs: globalStubs },
    })
    await wrapper.get('[data-testid="desktop-user-menu-trigger"]').trigger('click')
    await wrapper.get('[data-testid="stub-logout"]').trigger('click')
    await flushPromises()

    expect(h.s.logout).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="stub-account-panel"]').exists()).toBe(false)
  })
})
