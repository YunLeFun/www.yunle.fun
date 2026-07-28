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

    expect(wrapper.text()).toContain('保存成功')
    expect(wrapper.text()).toContain('资料已经更新')
    expect(wrapper.get('[aria-label="关闭通知"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
