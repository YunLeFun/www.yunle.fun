// @vitest-environment nuxt
import type { ExplorerCategory } from '../../app/types/app-explorer'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppDiscoveryToolbar from '../../app/components/apps/AppDiscoveryToolbar.vue'

const categories: ExplorerCategory[] = [
  {
    id: 'inspiration',
    label: '灵感智能',
    description: '智能应用',
    icon: 'i-lucide-sparkles',
  },
  {
    id: 'play',
    label: '轻松一下',
    description: '互动玩具',
    icon: 'i-lucide-gamepad-2',
  },
]

describe('appDiscoveryToolbar', () => {
  it('emits search and category changes without duplicating state', async () => {
    const wrapper = await mountSuspended(AppDiscoveryToolbar, {
      props: {
        query: '',
        selectedCategory: 'all',
        categories,
        resultCount: 2,
      },
    })

    await wrapper.get('input[type="search"]').setValue('AI')
    await wrapper.get('[data-category="inspiration"]').trigger('click')

    expect(wrapper.emitted('update:query')?.at(-1)).toEqual(['AI'])
    expect(wrapper.emitted('update:category')?.at(-1)).toEqual(['inspiration'])
  })
})
