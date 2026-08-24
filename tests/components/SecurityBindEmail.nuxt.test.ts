// @vitest-environment nuxt
import type { Mock } from 'vitest'
import type { Ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import SecurityBindEmail from '../../app/components/settings/SecurityBindEmail.vue'
import { EmailBindingError } from '../../app/composables/auth/types'

interface AuthMockState {
  user: Ref<{ id: string, email: string | null }>
  bindEmail: Mock
  verifyBindEmail: Mock
  loading: Ref<boolean>
}

const authMocks = vi.hoisted(() => ({ state: {} as AuthMockState }))

mockNuxtImport('useTcbAuth', () => () => ({
  user: authMocks.state.user,
  bindEmail: authMocks.state.bindEmail,
  verifyBindEmail: authMocks.state.verifyBindEmail,
  loading: authMocks.state.loading,
}))

mockNuxtImport('useCountdown', () => () => ({
  remaining: shallowRef(0),
  isActive: shallowRef(false),
  start: vi.fn(),
}))

const stubs = {
  Button: {
    props: ['disabled', 'type'],
    emits: ['click'],
    template: '<button :type="type || \'button\'" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  DialogClose: { template: '<div><slot /></div>' },
  DialogContent: { template: '<section><slot /></section>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<footer><slot /></footer>' },
  DialogHeader: { template: '<header><slot /></header>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  Field: { template: '<div><slot /></div>' },
  FieldDescription: { template: '<p><slot /></p>' },
  FieldError: { template: '<p role="alert"><slot /></p>' },
  FieldGroup: { template: '<div><slot /></div>' },
  FieldLabel: { template: '<label><slot /></label>' },
  InputGroup: { template: '<div><slot /></div>' },
  InputGroupAddon: { template: '<span><slot /></span>' },
  InputGroupInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  SecurityCredentialRow: {
    emits: ['action'],
    template: '<button data-testid="email-bind-action" @click="$emit(\'action\')">绑定邮箱</button>',
  },
  SecurityOtpInput: {
    props: ['modelValue', 'invalid'],
    emits: ['update:modelValue', 'resend'],
    template: '<input data-testid="email-bind-otp" :value="modelValue" :aria-invalid="invalid || undefined" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  SecurityVerificationProgress: true,
  Spinner: true,
}

describe('security email binding feedback', () => {
  beforeEach(() => {
    authMocks.state.user = shallowRef({ id: 'user-001', email: 'bound@example.com' })
    authMocks.state.bindEmail = vi.fn().mockResolvedValue({ verifyOtp: vi.fn() })
    authMocks.state.verifyBindEmail = vi.fn().mockResolvedValue(undefined)
    authMocks.state.loading = shallowRef(false)
  })

  it('输入当前账号邮箱时立即在字段下提示，不请求验证码', async () => {
    const wrapper = await mountSuspended(SecurityBindEmail, { global: { stubs } })

    await wrapper.get('[data-testid="email-bind-action"]').trigger('click')
    await wrapper.get('#email-bind-address').setValue(' BOUND@example.com ')
    await wrapper.get('#email-bind-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('该邮箱已绑定当前账号')
    expect(authMocks.state.bindEmail).not.toHaveBeenCalled()
  })

  it('把服务端邮箱占用错误回填到邮箱字段', async () => {
    authMocks.state.bindEmail = vi.fn().mockRejectedValue(new EmailBindingError({
      field: 'email',
      title: '该邮箱已被使用',
      description: '该邮箱已绑定其他账号，请更换邮箱，或退出后使用该邮箱登录原账号。',
      code: 'already_exists',
    }, new Error('raw provider error')))
    const wrapper = await mountSuspended(SecurityBindEmail, { global: { stubs } })

    await wrapper.get('[data-testid="email-bind-action"]').trigger('click')
    await wrapper.get('#email-bind-address').setValue('other@example.com')
    await wrapper.get('#email-bind-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('该邮箱已绑定其他账号，请更换邮箱，或退出后使用该邮箱登录原账号。')
    expect(wrapper.get('#email-bind-address').attributes('aria-invalid')).toBe('true')
    expect(authMocks.state.bindEmail).toHaveBeenCalledExactlyOnceWith('other@example.com')
  })

  it('发送成功后在弹窗内展示并播报目标邮箱', async () => {
    const wrapper = await mountSuspended(SecurityBindEmail, { global: { stubs } })

    await wrapper.get('[data-testid="email-bind-action"]').trigger('click')
    await wrapper.get('#email-bind-address').setValue('other@example.com')
    await wrapper.get('#email-bind-form').trigger('submit')
    await flushPromises()

    const description = wrapper.get('[aria-live="polite"]')
    expect(description.text()).toBe('验证码已发送至 other@example.com')
    expect(authMocks.state.bindEmail).toHaveBeenCalledExactlyOnceWith('other@example.com')
  })

  it('把服务端验证码错误回填到验证码字段，并在重新输入时清除', async () => {
    const bindData = { verifyOtp: vi.fn() }
    authMocks.state.bindEmail = vi.fn().mockResolvedValue(bindData)
    authMocks.state.verifyBindEmail = vi.fn().mockRejectedValue(new EmailBindingError({
      field: 'otp',
      title: '验证码无效',
      description: '验证码错误或已过期，请重新输入或获取新验证码。',
      code: 'invalid_verification_code',
    }, new Error('raw provider error')))
    const wrapper = await mountSuspended(SecurityBindEmail, { global: { stubs } })

    await wrapper.get('[data-testid="email-bind-action"]').trigger('click')
    await wrapper.get('#email-bind-address').setValue('other@example.com')
    await wrapper.get('#email-bind-form').trigger('submit')
    await flushPromises()

    await wrapper.get('[data-testid="email-bind-otp"]').setValue('123456')
    await wrapper.get('#email-verify-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('验证码错误或已过期，请重新输入或获取新验证码。')
    expect(wrapper.get('[data-testid="email-bind-otp"]').attributes('aria-invalid')).toBe('true')
    expect(authMocks.state.verifyBindEmail).toHaveBeenCalledExactlyOnceWith(bindData, 'other@example.com', '123456')

    await wrapper.get('[data-testid="email-bind-otp"]').setValue('654321')
    expect(wrapper.text()).not.toContain('验证码错误或已过期，请重新输入或获取新验证码。')
  })
})
