// @vitest-environment nuxt
import type { AppRecord } from '../../app/types/app'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AppDiscoveryGrid from '../../app/components/apps/AppDiscoveryGrid.vue'
import { normalizeExplorerApps } from '../../app/utils/app-explorer'

function makeApp(slug: string, overrides: Partial<AppRecord> = {}) {
  return normalizeExplorerApps([{
    _id: slug,
    _openid: 'owner',
    ownerId: 'owner',
    ownerLogin: 'YunYouJun',
    name: slug,
    slug,
    description: `${slug} description`,
    isPublic: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }])[0]!
}

describe('appDiscoveryGrid', () => {
  it('renders loading skeletons', async () => {
    const wrapper = await mountSuspended(AppDiscoveryGrid, {
      props: { apps: [], loading: true, error: null, hasFilters: false },
    })

    expect(wrapper.findAll('[data-testid="app-skeleton"]')).toHaveLength(6)
  })

  it('offers retry for an error state', async () => {
    const wrapper = await mountSuspended(AppDiscoveryGrid, {
      props: { apps: [], loading: false, error: '加载失败', hasFilters: false },
    })

    await wrapper.get('[data-testid="retry-apps"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('distinguishes an empty collection from filtered empty results', async () => {
    const empty = await mountSuspended(AppDiscoveryGrid, {
      props: { apps: [], loading: false, error: null, hasFilters: false },
    })
    expect(empty.text()).toContain('暂时还没有公开应用')

    const filtered = await mountSuspended(AppDiscoveryGrid, {
      props: { apps: [], loading: false, error: null, hasFilters: true },
    })
    expect(filtered.text()).toContain('没有找到匹配的应用')
    await filtered.get('[data-testid="clear-app-filters"]').trigger('click')
    expect(filtered.emitted('clear')).toHaveLength(1)
  })

  it('links to application details and falls back from an image to emoji', async () => {
    const app = makeApp('ai-sfc', { icon: '/broken.png', emoji: '🪄' })
    const wrapper = await mountSuspended(AppDiscoveryGrid, {
      props: { apps: [app], loading: false, error: null, hasFilters: false },
    })

    expect(wrapper.get('a[href="/apps/ai-sfc"]').exists()).toBe(true)
    await wrapper.get('[data-testid="app-icon-image"]').trigger('error')
    await nextTick()
    expect(wrapper.get('[data-testid="app-icon-emoji"]').text()).toBe('🪄')
  })
})
