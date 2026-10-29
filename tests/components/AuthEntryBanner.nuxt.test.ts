// @vitest-environment nuxt
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import AuthEntryBanner from '../../app/components/auth/AuthEntryBanner.vue'

const wrappers: VueWrapper[] = []

async function mount(redirect: string) {
  const wrapper = await mountSuspended(AuthEntryBanner, {
    route: `/login?${new URLSearchParams({ redirect })}`,
    global: {
      stubs: {
        Icon: true,
        AppProductIcon: {
          props: ['app'],
          template: '<span data-testid="target-app-icon" :data-app-id="app.appId" />',
        },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

function authorizationRoute(redirectUri: string) {
  return `/auth/sso?${new URLSearchParams({
    client_id: 'cms-web',
    redirect_uri: redirectUri,
  })}`
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0))
    wrapper.unmount()
})

describe('auth entry destination', () => {
  it('shows the complete registered host alongside the verified app identity', async () => {
    const wrapper = await mount(authorizationRoute('https://cms.yunle.fun/'))

    expect(wrapper.text()).toContain('cms.yunle.fun')
    expect(wrapper.get('[data-testid="target-app-icon"]').attributes('data-app-id')).toBe('cms')
    expect(wrapper.find('[role="note"]').exists()).toBe(false)
  })

  it('shows the actual host and warning without borrowing a registered app identity for a forged callback', async () => {
    const wrapper = await mount(authorizationRoute('https://untrusted.example/'))

    expect(wrapper.text()).toContain('untrusted.example')
    expect(wrapper.get('[role="note"]').text()).toContain('未能核验来源')
    expect(wrapper.find('[data-testid="target-app-icon"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('云栈')
  })

  it('preserves the complete device code and its character-by-character accessible label', async () => {
    const code = 'ABCD-EFGH'
    const wrapper = await mount(`/link?${new URLSearchParams({ code })}`)

    expect(wrapper.get('code').text()).toBe(code)
    expect(wrapper.get('code').attributes('aria-label')).toBe(`设备码 ${code.split('').join(' ')}`)
    expect(wrapper.text()).toContain('请核对桌面应用上的设备码')
  })
})
