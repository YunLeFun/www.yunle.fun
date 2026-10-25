// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
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
}

describe('settings security credentials', () => {
  beforeEach(() => {
    h.s.user = ref({
      id: 'email-user',
      email: 'tester@example.com',
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

  it('shows actual credential states and reacts to binding changes without a security score', async () => {
    h.s.user.value.hasPassword = false
    const wrapper = await mountSuspended(SecurityTab, { global: { stubs } })
    await flushPromises()

    const overview = wrapper.get('[aria-label="登录凭证状态"]')
    expect(overview.text()).toContain('邮箱已绑定')
    expect(overview.text()).toContain('手机未绑定')
    expect(overview.text()).toContain('密码未设置')
    expect(wrapper.find('.security-meter').exists()).toBe(false)

    h.s.user.value = { ...h.s.user.value, phone: '13800138000', hasPassword: true }
    await nextTick()
    expect(overview.text()).toContain('手机已绑定')
    expect(overview.text()).toContain('密码已设置')
    expect(overview.text()).not.toContain('未绑定')
    wrapper.unmount()
  })

  it('does not report an unset password before its status is available', async () => {
    const wrapper = await mountSuspended(SecurityTab, { global: { stubs } })
    expect(wrapper.get('[aria-label="登录凭证状态"]').text()).toContain('密码状态待确认')
    wrapper.unmount()
  })

  it('requires confirmation to unbind an identity and prevents duplicate submission', async () => {
    h.s.user.value.providers = ['email', 'github']
    let finish: () => void = () => {}
    h.s.unbindIdentity.mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const wrapper = await mountSuspended(SecurityTab, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    const unbind = wrapper.findAll('button').find(button => button.text() === '解绑')!
    await unbind.trigger('click')
    await flushPromises()
    expect(h.s.unbindIdentity).not.toHaveBeenCalled()
    const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
    const confirm = dialog.findAll('button').find(button => button.text() === '确认解绑')!
    await confirm.trigger('click')
    await flushPromises()
    expect(h.s.unbindIdentity).toHaveBeenCalledExactlyOnceWith('github')
    expect(confirm.attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
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
