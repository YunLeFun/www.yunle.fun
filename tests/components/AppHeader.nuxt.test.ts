// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppHeader from '../../app/components/AppHeader.vue'

describe('app header', () => {
  it('provides translated accessible text for the mobile menu dialog', async () => {
    const wrapper = await mountSuspended(AppHeader, {
      global: {
        stubs: {
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
          UNavigationMenu: { template: '<nav />' },
          UColorModeButton: { template: '<button type="button" />' },
          ClientOnly: { template: '<slot />' },
          HeaderAuthArea: { template: '<div />' },
          HeaderAuthSkeleton: { template: '<div />' },
          YlfSiteMenu: { template: '<button type="button" />' },
          AppLogo: { template: '<span>云乐坊</span>' },
          USeparator: { template: '<hr>' },
        },
      },
    })

    expect(wrapper.get('[data-testid="menu-title"]').text()).toBe('主导航')
    expect(wrapper.get('[data-testid="menu-description"]').text()).toBe('浏览云乐坊的主要页面和账号入口')
  })
})
