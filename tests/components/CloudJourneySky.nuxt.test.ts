// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloudSeaCanvas from '../../app/components/clouds/CloudSeaCanvas.vue'
import DefaultLayout from '../../app/layouts/default.vue'

const currentRoute = vi.hoisted(() => ({ path: '/' }))
const readyCallbacks = vi.hoisted(() => [] as (() => void)[])
mockNuxtImport('useRoute', () => () => currentRoute)
mockNuxtImport('onNuxtReady', () => (callback: () => void) => readyCallbacks.push(callback))

const wrappers: Awaited<ReturnType<typeof mountSuspended>>[] = []

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  readyCallbacks.length = 0
})

describe('cloud journey on static hosting', () => {
  it('defers the scenery until a journey page is visited', async () => {
    const route = '/docs/getting-started'
    currentRoute.path = route
    const wrapper = await mountSuspended(DefaultLayout, {
      route,
      global: {
        stubs: { AppHeader: true, SiteAnnouncement: true, AppFooter: true, CloudSeaCanvas: true },
      },
    })
    wrappers.push(wrapper)

    expect(wrapper.find('.cloud-journey').exists()).toBe(false)
    expect(wrapper.findComponent(CloudSeaCanvas).exists()).toBe(false)
  })

  it.each(['/explore', '/explore/'])('places the interactive train in the shared scenery at %s', async (route) => {
    currentRoute.path = route
    const wrapper = await mountSuspended(DefaultLayout, {
      route,
      attachTo: document.body,
      slots: {
        default: '<section data-cloud-journey="/explore"><div data-cloud-coaches="3"></div></section>',
      },
      global: {
        stubs: { AppHeader: true, SiteAnnouncement: true, AppFooter: true, CloudSeaCanvas: true },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.get('#main-content').classes()).toContain('site-main--sky')
    expect(wrapper.get('.cloud-journey').attributes('style')).not.toContain('display: none')
    expect(wrapper.findComponent(CloudSeaCanvas).exists()).toBe(false)

    readyCallbacks.splice(0).forEach(callback => callback())
    await vi.waitFor(() => expect(wrapper.findComponent(CloudSeaCanvas).exists()).toBe(true))
    const canvas = wrapper.getComponent(CloudSeaCanvas)
    expect(canvas.props('playing')).toBe(true)
    expect(canvas.props('train')).toMatchObject({ coaches: 3 })
  })
})
