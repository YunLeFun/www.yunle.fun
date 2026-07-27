// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import SettingsPage from '../../app/pages/settings.vue'

const h = vi.hoisted(() => ({
  route: { query: { edit: 'profile' } as Record<string, string> },
  router: {
    afterEach: vi.fn(),
    beforeEach: vi.fn(),
    beforeResolve: vi.fn(),
    onError: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
}))

mockNuxtImport('useRoute', () => () => h.route)
mockNuxtImport('useRouter', () => () => h.router)
mockNuxtImport('useTcbAuth', () => () => ({
  user: ref({ id: 'u1', nickname: 'Alice' }),
  isAuthenticated: ref(true),
  loading: ref(false),
}))

const stubs = {
  SettingsAccountTab: { template: '<div>账户内容</div>' },
  SettingsPrivacyTab: { template: '<div>隐私内容</div>' },
  SettingsProfileTab: {
    props: ['startEditing'],
    emits: ['editFinished'],
    template: `
      <div data-testid="profile-tab" :data-start-editing="String(startEditing)">
        <button type="button" @click="$emit('editFinished')">完成编辑</button>
      </div>
    `,
  },
  SettingsSecurityTab: { template: '<div>安全内容</div>' },
}

describe('settings profile edit route', () => {
  beforeEach(() => {
    h.route.query = { edit: 'profile' }
    h.router.afterEach.mockReset()
    h.router.beforeEach.mockReset()
    h.router.beforeResolve.mockReset()
    h.router.onError.mockReset()
    h.router.push.mockReset()
    h.router.replace.mockReset()
  })

  it('labels the page as editing and passes the request to the profile form', async () => {
    const wrapper = await mountSuspended(SettingsPage, { global: { stubs } })

    expect(wrapper.get('h1').text()).toBe('编辑资料')
    expect(wrapper.get('[data-testid="profile-tab"]').attributes('data-start-editing')).toBe('true')
    expect(wrapper.text()).not.toContain('隐私与通知')
    expect(h.router.push).not.toHaveBeenCalled()
  })

  it('clears the edit request after finishing', async () => {
    const wrapper = await mountSuspended(SettingsPage, { global: { stubs } })

    const finish = wrapper.findAll('button').find(button => button.text() === '完成编辑')
    expect(finish).toBeTruthy()
    await finish!.trigger('click')

    expect(h.router.replace).toHaveBeenCalledWith({ query: {} })
  })

  it('uses accessible tabs and keeps the selected tab in the URL', async () => {
    h.route.query = { tab: 'security' }

    const wrapper = await mountSuspended(SettingsPage, { global: { stubs } })
    const tabList = wrapper.get('[role="tablist"]')
    const tabButtons = tabList.findAll('[role="tab"]')
    const securityTab = tabButtons.find(tab => tab.text().includes('安全设置'))
    const accountTab = tabButtons.find(tab => tab.text().includes('账户管理'))

    expect(tabButtons).toHaveLength(4)
    expect(securityTab?.attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('安全内容')
    expect(wrapper.text()).not.toContain('账户内容')

    await accountTab!.trigger('mousedown', { button: 0, ctrlKey: false })
    await nextTick()

    await vi.waitFor(() => {
      expect(h.router.replace).toHaveBeenCalledWith({ query: { tab: 'account' } })
    })
  })
})
