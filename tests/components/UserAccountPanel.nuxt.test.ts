// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UserAccountPanel from '../../app/components/UserAccountPanel.vue'

const user = {
  id: 'user-1',
  login: 'skywalker',
  email: 'sky@example.com',
  phone: null,
  nickname: '晴空旅人',
  avatar: null,
}

const globalStubs = {
  MemberAvatar: {
    props: ['alt'],
    template: '<span data-testid="member-avatar">{{ alt }}</span>',
  },
  MemberBadge: {
    template: '<span data-testid="member-badge">会员</span>',
  },
  UIcon: {
    template: '<span aria-hidden="true" />',
  },
  USkeleton: {
    template: '<span data-testid="account-coin-skeleton" />',
  },
  NuxtLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}

describe('userAccountPanel', () => {
  it('organizes identity, high-value shortcuts, utilities, and logout into separate levels', async () => {
    const wrapper = await mountSuspended(UserAccountPanel, {
      props: {
        user,
        isMember: true,
        coinBalance: 128,
      },
      global: { stubs: globalStubs },
    })

    expect(wrapper.get('[data-testid="account-profile-link"]').attributes('href')).toBe('/profile')
    expect(wrapper.get('[data-testid="member-badge"]').text()).toBe('会员')
    expect(wrapper.get('[data-testid="account-wallet-link"]').attributes('href')).toBe('/wallet')
    expect(wrapper.get('[data-testid="account-wallet-link"]').attributes('aria-label')).toBe('我的云币，128 云币')
    expect(wrapper.get('[data-testid="account-coin-balance"]').text()).toBe('128')
    expect(wrapper.get('[data-testid="account-wallet-link"]').text()).not.toContain('我的云币')
    expect(wrapper.get('[data-testid="account-apps-link"]').attributes('href')).toBe('/apps')
    expect(wrapper.get('[data-testid="account-settings-link"]').attributes('href')).toBe('/settings')
    expect(wrapper.text()).not.toContain('复制 UID')
    expect(wrapper.get('[data-testid="account-logout"]').text()).toContain('退出登录')
  })

  it('shows a restrained regular-user status and a balance skeleton without hiding navigation', async () => {
    const wrapper = await mountSuspended(UserAccountPanel, {
      props: {
        user,
        coinLoading: true,
      },
      global: { stubs: globalStubs },
    })

    expect(wrapper.text()).toContain('普通用户')
    expect(wrapper.find('[data-testid="member-badge"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="account-coin-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="account-apps-link"]').exists()).toBe(true)
  })

  it('emits close for navigation and a dedicated logout event', async () => {
    const wrapper = await mountSuspended(UserAccountPanel, {
      props: { user },
      global: { stubs: globalStubs },
    })

    await wrapper.get('[data-testid="account-profile-link"]').trigger('click')
    await wrapper.get('[data-testid="account-logout"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('logout')).toHaveLength(1)
  })
})
