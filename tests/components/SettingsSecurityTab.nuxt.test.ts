// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SecurityTab from '../../app/components/settings/SecurityTab.vue'

const h = vi.hoisted(() => ({ s: {} as Record<string, any> }))

mockNuxtImport('useTcbAuth', () => () => ({
  user: h.s.user,
  bindPhone: h.s.bindPhone,
  verifyBindPhone: h.s.verifyBindPhone,
  bindGitHub: h.s.bindGitHub,
  bindWeChat: h.s.bindWeChat,
  unbindIdentity: h.s.unbindIdentity,
  getUserIdentities: h.s.getUserIdentities,
  loading: ref(false),
}))

const stubs = {
  SettingsSecurityBindEmail: true,
  SettingsSecurityPassword: true,
  SettingsSecurityDevices: true,
  UBadge: {
    props: ['label'],
    template: '<span>{{ label }}</span>',
  },
  UButton: {
    props: ['label', 'disabled', 'loading'],
    emits: ['click'],
    template: '<button type="button" :disabled="disabled || loading" @click="$emit(\'click\')">{{ label }}</button>',
  },
  UFormField: {
    props: ['label'],
    template: '<label>{{ label }}<slot /></label>',
  },
  UIcon: true,
  UInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  UModal: {
    template: '<div><slot name="content" /></div>',
  },
  UPageCard: {
    template: '<section><slot /></section>',
  },
}

describe('settings security credentials', () => {
  beforeEach(() => {
    h.s.user = ref({
      id: 'email-user',
      email: 'sanshiliuxiaoye@gmail.com',
      phone: null,
      providers: ['email'],
    })
    h.s.bindGitHub = vi.fn()
    h.s.bindWeChat = vi.fn()
    h.s.unbindIdentity = vi.fn()
    h.s.getUserIdentities = vi.fn(async () => [])
    h.s.bindPhone = vi.fn(async () => ({ verifyOtp: vi.fn() }))
    h.s.verifyBindPhone = vi.fn(async () => undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('offers a phone binding action to users who only have an email credential', async () => {
    const wrapper = await mountSuspended(SecurityTab, { global: { stubs } })
    await flushPromises()

    const action = wrapper.get('[data-testid="phone-bind-action"]')
    expect(action.text()).toBe('绑定')

    wrapper.unmount()
  })

  it('shows the GitHub login returned by the bound identity', async () => {
    h.s.getUserIdentities.mockResolvedValue([
      {
        id: 'github',
        name: 'RainCither',
        picture: 'https://avatars.githubusercontent.com/u/1',
      },
    ])

    const wrapper = await mountSuspended(SecurityTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('已绑定 @RainCither，可使用 GitHub 登录')

    wrapper.unmount()
  })

  it('binds a phone through the SMS verification flow', async () => {
    const bindData = { verifyOtp: vi.fn() }
    h.s.bindPhone.mockResolvedValue(bindData)
    const wrapper = await mountSuspended(SecurityTab, {
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()

    await wrapper.get('[data-testid="phone-bind-action"]').trigger('click')
    await flushPromises()

    const phoneInput = new DOMWrapper(document.querySelector('[data-testid="phone-number-input"]')!)
    await phoneInput.setValue('13800138000')
    await new DOMWrapper(document.querySelector('[data-testid="phone-send-otp"]')!).trigger('click')
    await flushPromises()

    expect(h.s.bindPhone).toHaveBeenCalledWith('13800138000')

    const otpInput = new DOMWrapper(document.querySelector('[data-testid="phone-otp-input"]')!)
    await otpInput.setValue('123456')
    await new DOMWrapper(document.querySelector('[data-testid="phone-confirm-bind"]')!).trigger('click')
    await flushPromises()

    expect(h.s.verifyBindPhone).toHaveBeenCalledWith(bindData, '13800138000', '123456')

    wrapper.unmount()
  })
})
