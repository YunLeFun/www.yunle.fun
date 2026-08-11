// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppFooter from '../../app/components/AppFooter.vue'

const globalStubs = {
  YlfLogo: { template: '<span />' },
  Separator: { template: '<hr>' },
  AppContainer: { template: '<div><slot /></div>' },
  AppButton: {
    props: ['to', 'ariaLabel'],
    template: '<a :href="to" :aria-label="ariaLabel" />',
  },
}

describe('app footer', () => {
  it('exposes the support center after the help entry', async () => {
    const wrapper = await mountSuspended(AppFooter, {
      global: { stubs: globalStubs },
    })
    const resourceLinks = wrapper.findAll('section').find(section => section.get('h2').text() === '资源')!.findAll('a')

    expect(resourceLinks.map(link => link.text())).toEqual([
      '网站地图',
      '帮助',
      '支持中心',
      '博客',
      '日志',
    ])
    expect(wrapper.get('a[href="https://support.yunle.fun/"]').text()).toBe('支持中心')
  })
})
