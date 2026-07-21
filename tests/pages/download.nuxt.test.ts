// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DownloadPage from '../../app/pages/download.vue'

describe('download page', () => {
  it('uses one H1 and exposes only real destinations as links', async () => {
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
})
