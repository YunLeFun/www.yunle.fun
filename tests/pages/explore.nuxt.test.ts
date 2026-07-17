// @vitest-environment nuxt
import type { AppRecord } from '../../app/types/app'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { homePage } from '../../app/config/home'
import ExplorePage from '../../app/pages/explore.vue'

const h = vi.hoisted(() => ({
  getOfficialApps: vi.fn(),
}))

mockNuxtImport('useApps', () => () => ({
  getOfficialApps: h.getOfficialApps,
}))

function makeApp(slug: string, name: string): AppRecord {
  return {
    _id: slug,
    _openid: 'owner',
    ownerId: 'owner',
    ownerLogin: 'YunYouJun',
    name,
    slug,
    description: `${name} description`,
    emoji: '☁️',
    isPublic: true,
    createdAt: 1,
    updatedAt: 2,
  }
}

const apps = [
  makeApp('ai-sfc', 'AI 春联'),
  makeApp('fc', 'FC 红白机'),
]

describe('explore page', () => {
  beforeEach(() => {
    h.getOfficialApps.mockReset()
    h.getOfficialApps.mockResolvedValue(apps)
  })

  it('loads public apps and shares filtering between the cloud and grid', async () => {
    const wrapper = await mountSuspended(ExplorePage)
    await flushPromises()
    await nextTick()

    expect(h.getOfficialApps).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="cloud-island-ai-sfc"]').exists()).toBe(true)
    expect(wrapper.findAll('a[href="/apps/ai-sfc"]').length).toBeGreaterThan(1)
    expect(wrapper.get('[data-testid="cloud-island-fc"]').exists()).toBe(true)

    await wrapper.get('input[type="search"]').setValue('AI')
    await nextTick()

    expect(wrapper.get('[data-testid="cloud-island-ai-sfc"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-island-fc"]').exists()).toBe(false)
    expect(wrapper.findAll('a[href="/apps/fc"]')).toHaveLength(0)
  })

  it('retries loading after a transient error', async () => {
    h.getOfficialApps
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(apps)

    const wrapper = await mountSuspended(ExplorePage)
    await flushPromises()
    await nextTick()

    await wrapper.get('[data-testid="retry-apps"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(h.getOfficialApps).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="cloud-island-ai-sfc"]').exists()).toBe(true)
  })

  it('uses the public atlas as the homepage exploration entry', () => {
    expect(homePage.hero.links[0]).toMatchObject({ to: '/explore' })
    expect(homePage.hero.links[0]).not.toHaveProperty('target')
  })
})
