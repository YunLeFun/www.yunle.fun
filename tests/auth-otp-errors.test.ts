import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useTcbOtp } from '../app/composables/auth/useOtp'

describe('otp error feedback', () => {
  const emailLoginDescription = '暂时无法使用该邮箱登录，请先使用手机号或 GitHub 登录，并在账号设置中绑定邮箱。'

  it('未绑定邮箱在发送阶段被拒绝时显示安全引导', async () => {
    const providerError = {
      code: 'registration_not_supported',
      message: 'raw provider registration error',
    }
    const toast = { add: vi.fn() }
    const core = {
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ data: null, error: providerError }),
      },
      router: { currentRoute: ref({ query: {} }), push: vi.fn() },
      toast,
      loading: ref(false),
      error: ref<string | null>(null),
      fetchUser: vi.fn(),
    }

    const { sendEmailOtp } = useTcbOtp(core as never)

    await expect(sendEmailOtp('new@example.com')).rejects.toBe(providerError)
    expect(core.error.value).toBe(emailLoginDescription)
    expect(toast.add).toHaveBeenCalledWith({
      title: '无法使用邮箱登录',
      description: emailLoginDescription,
      color: 'error',
    })
  })

  it('未绑定邮箱在验证码验证阶段被拒绝时显示相同的安全引导', async () => {
    const providerError = {
      code: 'USER_NOT_FOUND',
      message: 'raw provider user lookup error',
    }
    const toast = { add: vi.fn() }
    const core = {
      auth: {},
      router: { currentRoute: ref({ query: {} }), push: vi.fn() },
      toast,
      loading: ref(false),
      error: ref<string | null>(null),
      fetchUser: vi.fn(),
    }
    const otpData = {
      verifyOtp: vi.fn().mockResolvedValue({ data: null, error: providerError }),
    }

    const { verifyEmailOtp } = useTcbOtp(core as never)

    await expect(verifyEmailOtp(otpData as never, '123456')).rejects.toBe(providerError)
    expect(core.error.value).toBe(emailLoginDescription)
    expect(toast.add).toHaveBeenCalledWith({
      title: '无法使用邮箱登录',
      description: emailLoginDescription,
      color: 'error',
    })
    expect(core.fetchUser).not.toHaveBeenCalled()
    expect(core.router.push).not.toHaveBeenCalled()
  })

  it('手机号在免打扰名单时显示注册场景提示和客服操作', async () => {
    const providerError = Object.assign(
      new Error('FailedOperation.PhoneNumberInBlacklist msg number on the blacklist'),
      { code: 'send_error_code', requestId: 'req_sms_blacklist_001' },
    )
    const toast = { add: vi.fn() }
    const auth = {
      signUp: vi.fn().mockResolvedValue({ data: {}, error: providerError }),
    }
    const core = {
      auth,
      router: { currentRoute: ref({ query: {} }), push: vi.fn() },
      toast,
      loading: ref(false),
      error: ref<string | null>(null),
      fetchUser: vi.fn(),
    }

    const { signUpWithPhone } = useTcbOtp(core as never)

    await expect(signUpWithPhone('13800138000')).rejects.toBe(providerError)
    expect(core.error.value).toBe('该手机号当前无法接收验证码，请更换手机号或联系客服协助处理。')
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({
      title: '验证码发送失败',
      description: '该手机号当前无法接收验证码，请更换手机号或联系客服协助处理。',
      color: 'error',
      duration: 10_000,
      action: expect.objectContaining({
        label: '联系客服',
        target: '_blank',
      }),
    }))
  })
})
