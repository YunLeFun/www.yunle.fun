// @vitest-environment nuxt
import type { AppRecord } from '../../app/types/app'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import HomeAppShowcase from '../../app/components/HomeAppShowcase.vue'

const h = vi.hoisted(() => ({
  getOfficialApps: vi.fn(),
}))

mockNuxtImport('useApps', () => () => ({
  getOfficialApps: h.getOfficialApps,
}))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => ({
    authReady: ref(true),
    checkAuthStatus: vi.fn(),
  }),
}))

function makeApp(): AppRecord {
  return {
    _id: 'ai-sfc',
    _openid: 'owner',
    ownerId: 'owner',
    ownerLogin: 'YunYouJun',
    name: 'AI 春联',
    slug: 'ai-sfc',
    description: '生成一副春联',
    isPublic: true,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('home app showcase', () => {
  beforeEach(() => {
    h.getOfficialApps.mockReset()
    h.getOfficialApps.mockResolvedValue([makeApp()])
  })

  it('renders the official application data returned by the marketplace', async () => {
    const wrapper = await mountSuspended(HomeAppShowcase)

    await flushPromises()
    await nextTick()

    expect(h.getOfficialApps).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="cloud-island-ai-sfc"]').attributes('aria-label')).toContain('AI 春联')
    expect(wrapper.text()).not.toContain('10+')
  })
})
