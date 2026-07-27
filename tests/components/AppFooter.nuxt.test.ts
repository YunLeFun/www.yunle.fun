// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppFooter from '../../app/components/AppFooter.vue'

const globalStubs = {
  YlfLogo: { template: '<span />' },
  USeparator: { template: '<hr>' },
  UContainer: { template: '<div><slot /></div>' },
  UFooterColumns: {
    props: ['columns'],
    template: `
      <nav>
        <section v-for="column in columns" :key="column.label">
          <h2>{{ column.label }}</h2>
          <a v-for="item in column.children" :key="item.to" :href="item.to">{{ item.label }}</a>
        </section>
      </nav>
    `,
  },
  UFooter: {
    template: `
      <footer>
        <slot name="top" />
        <slot name="left" />
        <slot name="right" />
      </footer>
    `,
  },
  UButton: {
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
