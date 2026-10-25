// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SecurityDevices from '../../app/components/settings/SecurityDevices.vue'

const h = vi.hoisted(() => ({
  revoke: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../app/composables/useDesktopDevices', () => ({
  desktopAppLabel: () => '云乐坊',
  useDesktopDevices: () => ({
    devices: ref([{ appId: 'yunle', deviceId: 'device-1', deviceName: '我的电脑' }]),
    loading: ref(false),
    error: ref(null),
    refresh: h.refresh,
    revoke: h.revoke,
  }),
}))
mockNuxtImport('useAppToast', () => () => ({ add: h.toast }))

function dialogButton(text: string) {
  return new DOMWrapper(document.querySelector('[role="dialog"]')!)
    .findAll('button')
    .find(button => button.text() === text)!
}

describe('settings device authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('does not revoke on opening or canceling the confirmation', async () => {
    const wrapper = await mountSuspended(SecurityDevices, { attachTo: document.body })
    await wrapper.get('[aria-label="移除 我的电脑 的授权"]').trigger('click')
    await flushPromises()
    expect(h.revoke).not.toHaveBeenCalled()
    await dialogButton('取消').trigger('click')
    await flushPromises()
    expect(h.revoke).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('keeps a failed confirmation available for retry and closes only on success', async () => {
    h.revoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const wrapper = await mountSuspended(SecurityDevices, { attachTo: document.body })
    await wrapper.get('[aria-label="移除 我的电脑 的授权"]').trigger('click')
    await flushPromises()
    await dialogButton('确认移除').trigger('click')
    await flushPromises()
    expect(h.revoke).toHaveBeenCalledWith('yunle', 'device-1')
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '移除失败，请重试' }))
    expect(dialogButton('确认移除').attributes('disabled')).toBeUndefined()
    await dialogButton('确认移除').trigger('click')
    await flushPromises()
    expect(h.revoke).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    wrapper.unmount()
  })
})
