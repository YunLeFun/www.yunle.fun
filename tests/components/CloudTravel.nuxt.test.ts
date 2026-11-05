// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { CLOUD_TRAVEL_DURATION, useCloudTravel } from '../../app/composables/useCloudTravel'

const TravelHarness = defineComponent({
  setup() {
    const { traveling } = useCloudTravel()
    return () => h('div', { 'data-playing': traveling.value, 'data-duration': CLOUD_TRAVEL_DURATION })
  },
})

const wrappers: Awaited<ReturnType<typeof mountSuspended>>[] = []
const links: HTMLAnchorElement[] = []

async function setup() {
  const wrapper = await mountSuspended(TravelHarness, { route: '/' })
  wrappers.push(wrapper)
  const link = document.createElement('a')
  link.href = '/explore'
  link.dataset.cloudLink = ''
  document.body.append(link)
  links.push(link)
  return { wrapper, link }
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0))
    wrapper.unmount()
  for (const link of links.splice(0))
    link.remove()
  vi.useRealTimers()
})

describe('cloud navigation enhancement', () => {
  it('starts alongside the ordinary click without preventing navigation, then cleans up', async () => {
    const { wrapper, link } = await setup()
    vi.useFakeTimers()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    expect(link.dispatchEvent(click)).toBe(true)
    expect(click.defaultPrevented).toBe(false)
    await nextTick()
    expect(wrapper.attributes('data-playing')).toBe('true')
    expect(wrapper.attributes('data-duration')).toBe('450')
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.attributes('data-playing')).toBe('false')
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves alternate navigation %j', async (modifiers) => {
    const { wrapper, link } = await setup()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }))
    await nextTick()
    expect(wrapper.attributes('data-playing')).toBe('false')
  })

  it('leaves new-tab, external, download and unrelated links alone', async () => {
    const { wrapper, link } = await setup()
    for (const attrs of [
      { href: '/explore', target: '_blank', download: null },
      { href: 'https://example.com/explore', target: '', download: null },
      { href: '/explore', target: '', download: 'apps' },
      { href: '/pricing', target: '', download: null },
    ]) {
      link.href = attrs.href
      link.target = attrs.target
      if (attrs.download === null)
        link.removeAttribute('download')
      else
        link.download = attrs.download
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await nextTick()
      expect(wrapper.attributes('data-playing')).toBe('false')
    }
  })
})
