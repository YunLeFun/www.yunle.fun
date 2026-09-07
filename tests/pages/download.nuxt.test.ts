// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import DownloadPage from '../../app/pages/download.vue'
import { defaultDownloads } from '../../shared/public-content'

const state = vi.hoisted(() => ({ content: undefined as unknown }))
mockNuxtImport('usePublicContent', () => () => ({ data: ref(state.content), error: ref(null) }))

describe('download page', () => {
  it('uses one H1 and exposes only real destinations as links', async () => {
    state.content = undefined
    const wrapper = await mountSuspended(DownloadPage)

    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.get('h1').text()).toContain('下载应用')
    expect(wrapper.find('a[href="#"]').exists()).toBe(false)
    expect(wrapper.get('a[href="https://apps.yunle.fun/"]').text()).toContain('在线访问')
    expect(wrapper.findAll('button[disabled]').map(button => button.text())).toEqual([
      expect.stringContaining('暂未开放'),
      expect.stringContaining('暂未开放'),
    ])
  })
  it('exposes one App Store link only for an enabled iOS release', async () => {
    const items = defaultDownloads.items.map(item => item.platform === 'ios'
      ? { ...item, enabled: true, version: '1.0', url: 'https://apps.apple.com/app/id123' }
      : item)
    state.content = { content: { ...defaultDownloads, items } }
    const open = await mountSuspended(DownloadPage)
    expect(open.get('a[href="https://apps.apple.com/app/id123"]').text()).toBe('前往 App Store')
    expect(open.get('a[href="https://apps.apple.com/app/id123"]').attributes('target')).toBe('_blank')
    expect(open.findAll('a[href^="https://apps.apple.com/"]')).toHaveLength(1)
    expect(open.text()).not.toContain('扫码')
    open.unmount()
    items[0]!.enabled = false
    const closed = await mountSuspended(DownloadPage)
    expect(closed.find('a[href="https://apps.apple.com/app/id123"]').exists()).toBe(false)
    expect(closed.text()).not.toContain('Mac App Store')
    expect(closed.text()).not.toContain('用 iPhone / iPad 扫码')
    closed.unmount()
  })
})
