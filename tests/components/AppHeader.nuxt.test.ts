// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppHeader from '../../app/components/AppHeader.vue'

const globalStubs = {
  UHeader: {
    props: ['menu'],
    template: `
      <header>
        <span data-testid="menu-title">{{ menu?.title }}</span>
        <span data-testid="menu-description">{{ menu?.description }}</span>
        <slot name="left" />
        <slot />
        <slot name="right" />
        <slot name="body" />
      </header>
    `,
  },
  UNavigationMenu: {
    props: ['items'],
    template: '<nav><a v-for="item in items" :key="item.to" :href="item.to">{{ item.label }}</a></nav>',
  },
  UColorModeButton: { template: '<button type="button" />' },
  ClientOnly: { template: '<slot />' },
  HeaderAuthArea: { template: '<div />' },
  HeaderAuthSkeleton: { template: '<div />' },
  YlfSiteMenu: { template: '<button type="button" />' },
  AppLogo: { template: '<span>云乐坊</span>' },
  USeparator: { template: '<hr>' },
}

describe('app header', () => {
  it('provides translated accessible text for the mobile menu dialog', async () => {
    const wrapper = await mountSuspended(AppHeader, {
      global: { stubs: globalStubs },
    })

    expect(wrapper.get('[data-testid="menu-title"]').text()).toBe('主导航')
    expect(wrapper.get('[data-testid="menu-description"]').text()).toBe('浏览云乐坊的主要页面和账号入口')
    expect(wrapper.findAll('a[href="/docs"]')[0]?.text()).toBe('帮助')
    expect(wrapper.find('a[href="/developer"]').exists()).toBe(false)
  })

  it('keeps a stable minimum while allowing authenticated controls to expand', async () => {
    const wrapper = await mountSuspended(AppHeader, {
      global: { stubs: globalStubs },
    })

    const authSlot = wrapper.get('[data-testid="header-auth-slot"]')

    expect(authSlot.classes()).toContain('min-w-24')
    expect(authSlot.classes()).toContain('lg:min-w-48')
    expect(authSlot.classes()).toContain('shrink-0')
    expect(authSlot.classes().some(className => /(?:^|:)w-/.test(className))).toBe(false)
  })
})
