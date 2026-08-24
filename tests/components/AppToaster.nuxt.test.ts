// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import AppToaster from '../../app/components/AppToaster.vue'
import { useAppToast } from '../../app/composables/useAppToast'

const ToastHarness = defineComponent({
  components: { AppToaster },
  setup() {
    const toast = useAppToast()
    toast.clear()

    function notify() {
      toast.add({
        title: '保存成功',
        description: '资料已经更新',
        color: 'success',
        action: {
          label: '联系客服',
          href: 'https://support.yunle.fun/contact',
          target: '_blank',
        },
      })
    }

    return { notify }
  },
  template: `
    <div>
      <button type="button" @click="notify">显示通知</button>
      <AppToaster />
    </div>
  `,
})

describe('app toaster', () => {
  it('renders local reka-ui notifications and exposes an accessible close action', async () => {
    const wrapper = await mountSuspended(ToastHarness)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    const viewport = document.body.querySelector<HTMLElement>('[data-slot="toast-viewport"]')
    expect(viewport).not.toBeNull()
    expect(viewport?.closest('[role="region"]')?.parentElement).toBe(document.body)
    expect(viewport?.classList.contains('z-[100]')).toBe(true)
    expect(viewport?.textContent).toContain('保存成功')
    expect(viewport?.textContent).toContain('资料已经更新')

    const action = viewport?.querySelector<HTMLAnchorElement>('a[href="https://support.yunle.fun/contact"]')
    expect(action?.textContent).toContain('联系客服')
    expect(action?.target).toBe('_blank')
    expect(action?.rel).toBe('noopener noreferrer')
    expect(viewport?.querySelector('[aria-label="关闭通知"]')).not.toBeNull()

    wrapper.unmount()
  })
})
