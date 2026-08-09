import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useTcbOtp } from '../app/composables/auth/useOtp'

describe('otp error feedback', () => {
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
