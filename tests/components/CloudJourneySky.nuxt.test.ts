// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CloudSeaCanvas from '../../app/components/clouds/CloudSeaCanvas.vue'
import DefaultLayout from '../../app/layouts/default.vue'

const currentRoute = vi.hoisted(() => ({ path: '/' }))
mockNuxtImport('useRoute', () => () => currentRoute)

const wrappers: Awaited<ReturnType<typeof mountSuspended>>[] = []

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('cloud journey on static hosting', () => {
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
    const canvas = wrapper.getComponent(CloudSeaCanvas)
    expect(canvas.props('playing')).toBe(true)
    expect(canvas.props('train')).toMatchObject({ coaches: 3 })
  })
})
