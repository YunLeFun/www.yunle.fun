// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import AppCloudTrain from '../../app/components/apps/AppCloudTrain.vue'
import { ssoExplorerApps } from '../../app/config/sso-explorer'

const h = vi.hoisted(() => ({
  intersection: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
}))
mockNuxtImport('useIntersectionObserver', () => (_target, callback) => {
  h.intersection = callback
  return { stop: vi.fn() }
})
mockNuxtImport('useDocumentVisibility', () => () => shallowRef('visible'))
mockNuxtImport('useMediaQuery', () => () => shallowRef(false))

const wrappers: Awaited<ReturnType<typeof mountSuspended>>[] = []
async function setup(reducedMotion = false) {
  const wrapper = await mountSuspended(AppCloudTrain, {
    props: {
      apps: ssoExplorerApps,
      account: { status: 'guest', displayName: '云乐坊账号', to: '/login?redirect=%2Fexplore' },
      reducedMotion,
    },
    global: { stubs: { CloudSeaCanvas: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
})

describe('cloud train', () => {
  it('makes every registered app reachable, wraps both ways and keeps ordinary external links', async () => {
    const wrapper = await setup(true)
    for (const app of ssoExplorerApps) {
      const link = wrapper.get('.cloud-train__carriage')
      expect(link.attributes('data-app-id')).toBe(app.appId)
      expect(link.attributes('href')).toBe(app.origin)
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.text()).toContain(app.name)
      await wrapper.get('[aria-label="下一班应用"]').trigger('click')
    }
    expect(wrapper.get('.cloud-train__carriage').attributes('data-app-id')).toBe(ssoExplorerApps[0]!.appId)
    await wrapper.get('[aria-label="上一班应用"]').trigger('click')
    expect(wrapper.get('.cloud-train__carriage').attributes('data-app-id')).toBe(ssoExplorerApps.at(-1)!.appId)
    expect(wrapper.get('.cloud-train__ticket').attributes('href')).toContain('/login?redirect=%2Fexplore')
    await wrapper.get('.cloud-train__all').trigger('click')
    expect(wrapper.emitted('scrollToGrid')).toHaveLength(1)
  })

  it('only advances in view and pauses for hover, focus and explicit pause', async () => {
    const wrapper = await setup()
    vi.useFakeTimers()
    const current = () => wrapper.get('.cloud-train__carriage').attributes('data-app-id')
    await vi.advanceTimersByTimeAsync(7000)
    expect(current()).toBe(ssoExplorerApps[0]!.appId)
    h.intersection?.([{ isIntersecting: true }])
    await nextTick()
    await vi.advanceTimersByTimeAsync(6500)
    expect(current()).toBe(ssoExplorerApps[1]!.appId)
    for (const event of ['mouseenter', 'focusin']) {
      await wrapper.trigger(event)
      await vi.advanceTimersByTimeAsync(7000)
      expect(current()).toBe(ssoExplorerApps[1]!.appId)
      await wrapper.trigger(event === 'mouseenter' ? 'mouseleave' : 'focusout')
    }
    await wrapper.get('[aria-label="暂停列车轮播"]').trigger('click')
    await vi.advanceTimersByTimeAsync(7000)
    expect(current()).toBe(ssoExplorerApps[1]!.appId)
    await wrapper.get('[aria-label="播放列车轮播"]').trigger('click')
    await vi.advanceTimersByTimeAsync(6500)
    expect(current()).toBe(ssoExplorerApps[2]!.appId)
    h.intersection?.([{ isIntersecting: false }])
    await nextTick()
    await vi.advanceTimersByTimeAsync(7000)
    expect(current()).toBe(ssoExplorerApps[2]!.appId)
  })

  it('keeps reduced-motion mode static while allowing manual browsing', async () => {
    const wrapper = await setup(true)
    vi.useFakeTimers()
    h.intersection?.([{ isIntersecting: true }])
    await nextTick()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(wrapper.get('.cloud-train__carriage').attributes('data-app-id')).toBe(ssoExplorerApps[0]!.appId)
    expect(wrapper.find('[aria-label="暂停列车轮播"]').exists()).toBe(false)
    await wrapper.get('[aria-label="下一班应用"]').trigger('click')
    expect(wrapper.get('.cloud-train__carriage').attributes('data-app-id')).toBe(ssoExplorerApps[1]!.appId)
  })
})
