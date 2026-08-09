import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useTcbPassword } from '../app/composables/auth/usePassword'

describe('email binding policy', () => {
  it('已登录用户通过 updateUser 绑定邮箱并保持原 UID，不创建新账号', async () => {
    const uid = 'github-user-001'
    const email = 'bound@example.com'
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { id: uid, email } },
      error: null,
    })
    const auth = {
      updateUser: vi.fn().mockResolvedValue({
        data: { verifyOtp },
        error: null,
      }),
      signUp: vi.fn(),
    }
    const fetchUser = vi.fn()
    const core = {
      auth,
      router: { currentRoute: ref({ query: {} }), push: vi.fn() },
      toast: { add: vi.fn() },
      loading: ref(false),
      error: ref<string | null>(null),
      user: ref({ id: uid, email: null }),
      fetchUser,
    }

    const { bindEmail, verifyBindEmail } = useTcbPassword(core as never)
    const bindData = await bindEmail(email)
    const result = await verifyBindEmail(bindData as never, email, '123456')

    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ email })
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ email, token: '123456' })
    expect(result).toEqual({ user: { id: uid, email } })
    expect(result?.user.id).toBe(uid)
    expect(fetchUser).toHaveBeenCalledOnce()
    expect(auth.signUp).not.toHaveBeenCalled()
  })
})
