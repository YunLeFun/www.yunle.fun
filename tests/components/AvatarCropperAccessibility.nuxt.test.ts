// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AvatarCropper from '../../app/components/AvatarCropper.vue'

const stubs = {
  Button: { template: '<button type="button"><slot /></button>' },
  Dialog: { template: '<div><slot /></div>' },
  DialogContent: { template: '<section><slot /></section>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<footer><slot /></footer>' },
  DialogHeader: { template: '<header><slot /></header>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
}

describe('avatar cropper accessibility', () => {
  it('keeps the crop surface keyboard focusable and explains its controls', async () => {
    const wrapper = await mountSuspended(AvatarCropper, {
      props: { file: null, open: true },
      global: { stubs },
    })

    const canvas = wrapper.get('canvas[aria-label="头像裁剪区域"]')
    expect(canvas.attributes('tabindex')).toBe('0')
    expect(canvas.attributes('aria-describedby')).toBe('avatar-cropper-keyboard-help')
    expect(wrapper.get('#avatar-cropper-keyboard-help').text()).toContain('方向键')
  })
})
