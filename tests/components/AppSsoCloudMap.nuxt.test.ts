// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppSsoCloudMap from '../../app/components/apps/AppSsoCloudMap.vue'
import { ssoExplorerApps } from '../../app/config/sso-explorer'

const account = {
  status: 'guest' as const,
  displayName: '云乐坊账号',
  to: '/login?redirect=%2Fexplore',
}

describe('appSsoCloudMap', () => {
  it('renders registry-backed external application links and the account entry', async () => {
    const wrapper = await mountSuspended(AppSsoCloudMap, {
      props: { apps: ssoExplorerApps, account },
    })

    expect(wrapper.get('[data-testid="sso-account-cloud"]').attributes('href'))
      .toContain('/login?redirect=%2Fexplore')
    expect(wrapper.get('.sso-account-cloud__default-avatar').attributes('src'))
      .toBe('/yunle-account-avatar.png')

    const desktop = wrapper.get('.app-sso-cloud-map__desktop')
    for (const app of ssoExplorerApps) {
      const cloud = desktop.get(`[data-testid="sso-app-${app.appId}"]`)
      const externalLink = cloud.get('.sso-app-cloud__link')
      expect(externalLink.attributes('href')).toBe(app.origin)
      expect(externalLink.attributes('target')).toBe('_blank')
      expect(externalLink.attributes('aria-label')).toContain('支持统一账号')
    }

    expect(wrapper.find('[data-testid="cloud-preview"]').exists()).toBe(false)
  })

  it('highlights only the focused route and suppresses motion when requested', async () => {
    const wrapper = await mountSuspended(AppSsoCloudMap, {
      props: {
        apps: ssoExplorerApps,
        account,
        reducedMotion: true,
      },
    })

    const link = wrapper
      .get('.app-sso-cloud-map__desktop')
      .get('[data-testid="sso-app-ai-sfc"]')
      .get('.sso-app-cloud__link')

    await link.trigger('focus')
    await nextTick()

    expect(wrapper.findAll('.sso-cloud-routes__active')).toHaveLength(1)
    expect(wrapper.findAll('.sso-cloud-routes__beam')).toHaveLength(0)

    await link.trigger('blur')
    await nextTick()
    expect(wrapper.findAll('.sso-cloud-routes__active')).toHaveLength(0)
  })
})
