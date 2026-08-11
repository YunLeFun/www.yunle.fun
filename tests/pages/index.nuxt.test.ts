// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import IndexPage from '../../app/pages/index.vue'

const h = vi.hoisted(() => ({
  authStatus: undefined as unknown as ReturnType<typeof ref<'pending' | 'authenticated' | 'guest'>>,
  checkAuthStatus: () => Promise.resolve(),
}))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => ({
    authReady: { value: true },
    authStatus: h.authStatus,
    checkAuthStatus: h.checkAuthStatus,
  }),
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
  it('replaces signup links with the profile entry for authenticated users', async () => {
    h.authStatus = ref('authenticated')

    const wrapper = await mountSuspended(IndexPage, {
      global: { stubs: globalStubs },
    })

    expect(wrapper.findAll('a[href="/signup"]')).toHaveLength(0)
    expect(wrapper.findAll('a[href="/profile"]').length).toBeGreaterThan(0)
    expect(wrapper.text()).not.toContain('创建账号')

    h.authStatus.value = 'pending'
    await nextTick()

    expect(wrapper.findAll('a[href="/signup"]')).toHaveLength(0)
    expect(wrapper.findAll('a[href="/profile"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('创建账号')

    h.authStatus.value = 'guest'
    await nextTick()

    expect(wrapper.findAll('a[href="/signup"]').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('创建账号')
  }, 15_000)
})
