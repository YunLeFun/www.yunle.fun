// @vitest-environment nuxt
import type { AppRecord } from '../../app/types/app'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppCloudMap from '../../app/components/apps/AppCloudMap.vue'
import { normalizeExplorerApps } from '../../app/utils/app-explorer'

function makeApp(slug: string, name: string): AppRecord {
  return {
    _id: slug,
    _openid: 'owner',
    ownerId: 'owner',
    ownerLogin: 'YunYouJun',
    name,
    slug,
    description: `${name} 的介绍`,
    emoji: '☁️',
    isPublic: true,
    createdAt: 1,
    updatedAt: 2,
  }
}

const apps = normalizeExplorerApps([
  makeApp('ai-sfc', 'AI 春联'),
  makeApp('fc', 'FC 红白机'),
  makeApp('valaxy', 'Valaxy'),
])

describe('appCloudMap', () => {
  it('renders accessible application links and updates the preview on focus', async () => {
    const wrapper = await mountSuspended(AppCloudMap, { props: { apps } })

    for (const app of apps) {
      expect(wrapper.get(`[data-testid="cloud-island-${app.slug}"]`).attributes('aria-label'))
        .toContain(app.name)
    }

    await wrapper.get('[data-testid="cloud-island-fc"]').trigger('focus')
    await nextTick()
    expect(wrapper.get('[data-testid="cloud-preview"]').text()).toContain('FC 红白机')
    expect(wrapper.get('[data-testid="cloud-routes"]').attributes('aria-hidden')).toBe('true')
  })

  it('suppresses animated beams when reduced motion is requested', async () => {
    const wrapper = await mountSuspended(AppCloudMap, {
      props: { apps, reducedMotion: true },
    })

    expect(wrapper.findAll('.app-cloud-routes__beam')).toHaveLength(0)
  })
})
