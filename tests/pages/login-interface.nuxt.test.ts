// @vitest-environment nuxt
import type { VueWrapper } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import LoginPage from '../../app/pages/login.vue'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))

mockNuxtImport('useTcbAuth', () => () => h.state.auth)
mockNuxtImport('useAppToast', () => () => ({ add: h.state.toast }))

const wrappers: VueWrapper[] = []

async function mount() {
  const wrapper = await mountSuspended(LoginPage, {
    route: '/login',
    global: {
      stubs: {
        'Icon': true,
        'AppModal': true,
        // Keep real Transition behavior: its default test stub would conceal
        // an outgoing form that remains focusable until an animation ends.
        'transition': false,
        'transition-group': false,
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function button(wrapper: VueWrapper, text: string) {
  const control = wrapper.findAll('button').find(node => node.text().includes(text))
  if (!control)
    throw new Error(`Missing login control: ${text}`)
  return control
}

describe('login interface', () => {
  beforeEach(() => {
    localStorage.removeItem('ylf:last-successful-login-mode')
    h.state.toast = vi.fn()
    h.state.auth = {
      loading: ref(false),
      isAuthenticated: ref(false),
      sendPhoneOtp: vi.fn(),
      verifyPhoneOtp: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPassword: vi.fn(),
      confirmResetPassword: vi.fn(),
      loginWithGitHub: vi.fn(),
      loginWithWeChat: vi.fn(),
    }
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0))
      wrapper.unmount()
    localStorage.removeItem('ylf:last-successful-login-mode')
  })

  it('removes the outgoing password form as soon as the login mode changes', async () => {
    const wrapper = await mount()
    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(true)

    await button(wrapper, '短信登录').trigger('click')

    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(false)
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
    expect(wrapper.find('input[autocomplete="tel-national"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('+86')
    expect(button(wrapper, '短信登录').attributes('data-state')).toBe('on')
  })

  it('restores the saved login mode without restoring account credentials', async () => {
    localStorage.setItem('ylf:last-successful-login-mode', 'email')
    const wrapper = await mount()

    expect(button(wrapper, '邮箱登录').attributes('data-state')).toBe('on')
    expect(wrapper.get<HTMLInputElement>('input[type="email"]').element.value).toBe('')
    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(false)
  })

  it('sends the mainland number entered after the fixed +86 prefix', async () => {
    h.state.auth.sendPhoneOtp.mockResolvedValue({})
    const wrapper = await mount()
    await button(wrapper, '短信登录').trigger('click')

    const phone = wrapper.get('input[type="tel"]')
    await phone.setValue('1380000000')
    expect(button(wrapper, '获取验证码').attributes('disabled')).toBeDefined()

    await phone.setValue('13800000000')
    await button(wrapper, '获取验证码').trigger('click')
    await flushPromises()
    expect(h.state.auth.sendPhoneOtp).toHaveBeenCalledExactlyOnceWith('13800000000')
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(true)
  })

  it('keeps the selected mode and prevents OAuth submission while authentication is pending', async () => {
    let finishSignIn!: () => void
    h.state.auth.signInWithPassword.mockReturnValue(new Promise<void>((resolve) => {
      finishSignIn = resolve
    }))
    const wrapper = await mount()
    await wrapper.get('input[name="username"]').setValue('test-user')
    await wrapper.get('input[name="password"]').setValue('test-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const phone = button(wrapper, '短信登录')
    const github = button(wrapper, 'GitHub')
    expect(phone.attributes('disabled')).toBeDefined()
    expect(github.attributes('disabled')).toBeDefined()

    await phone.trigger('click')
    await github.trigger('click')

    expect(button(wrapper, '密码登录').attributes('data-state')).toBe('on')
    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(true)
    expect(h.state.auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ username: 'test-user', password: 'test-password' })
    expect(h.state.auth.loginWithGitHub).not.toHaveBeenCalled()
    expect(h.state.auth.sendPhoneOtp).not.toHaveBeenCalled()

    finishSignIn()
    await flushPromises()
  })
})
