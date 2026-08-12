// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import IndexPage from '../../app/pages/index.vue'

const h = vi.hoisted(() => ({
  useTcbAuthSession: vi.fn(),
}))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: h.useTcbAuthSession,
}))

const globalStubs = {
  SkyScene: {
    template: '<div />',
  },
  LazyHomeAppShowcase: {
    template: '<div />',
  },
  AppContainer: {
    template: '<div><slot /></div>',
  },
  UIcon: {
    template: '<span />',
  },
  AppButton: {
    props: ['to', 'label'],
    template: '<a v-if="to" :href="to">{{ label }}</a>',
  },
  NuxtLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
  AppPageCta: {
    props: ['title', 'description', 'links'],
    template: `
      <section>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
        <a v-for="link in links" :key="link.to" :href="link.to">{{ link.label }}</a>
      </section>
    `,
  },
}

describe('homepage account actions', () => {
  beforeEach(() => {
    h.useTcbAuthSession.mockClear()
    useState<boolean>('auth_ready', () => false).value = false
    useState<{ id?: string } | null>('auth_user', () => null).value = null
  })

  it('replaces signup links with the profile entry for authenticated users', async () => {
    useState<boolean>('auth_ready').value = true
    useState<{ id: string } | null>('auth_user').value = { id: 'user-1' }

    const wrapper = await mountSuspended(IndexPage, {
      global: { stubs: globalStubs },
    })

    expect(wrapper.findAll('a[href="/signup"]')).toHaveLength(0)
    expect(wrapper.findAll('a[href="/profile"]').length).toBeGreaterThan(0)
    expect(wrapper.text()).not.toContain('创建账号')
    expect(h.useTcbAuthSession).not.toHaveBeenCalled()

    useState<boolean>('auth_ready').value = false
    await nextTick()

    expect(wrapper.findAll('a[href="/signup"]')).toHaveLength(0)
    expect(wrapper.findAll('a[href="/profile"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('创建账号')

    useState<{ id: string } | null>('auth_user').value = null
    useState<boolean>('auth_ready').value = true
    await nextTick()

    expect(wrapper.findAll('a[href="/signup"]').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('创建账号')
  }, 15_000)
})
