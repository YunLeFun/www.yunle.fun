import type { TcbBindVerificationData, User } from '../app/composables/auth/types'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { EmailBindingError } from '../app/composables/auth/types'
import { useTcbPassword } from '../app/composables/auth/usePassword'

type PasswordCore = Parameters<typeof useTcbPassword>[0]

interface PasswordCoreOptions {
  auth?: Record<string, unknown>
  user?: User | null
}

function createTestUser(overrides: Partial<User> = {}): User {
  return {
    id: 'github-user-001',
    email: null,
    role: 'USER',
    hasPassword: false,
    providers: ['github'],
    identities: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function createPasswordCore(options: PasswordCoreOptions = {}) {
  const toastAdd = vi.fn()
  const fetchUser = vi.fn()
  const core = {
    auth: options.auth ?? {},
    router: { currentRoute: shallowRef({ query: {} }), push: vi.fn() },
    toast: { add: toastAdd },
    loading: shallowRef(false),
    error: shallowRef<string | null>(null),
    user: shallowRef(options.user === undefined ? createTestUser() : options.user),
    fetchUser,
  } as unknown as PasswordCore

  return { core, fetchUser, toastAdd }
}

describe('email binding policy', () => {
  it('已登录用户通过 updateUser 绑定邮箱并保持原 UID，不创建新账号', async () => {
    const uid = 'github-user-001'
    const email = 'bound@example.com'
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { id: uid, email } },
      error: null,
    })
    const bindData = { verifyOtp } satisfies TcbBindVerificationData
    const auth = {
      updateUser: vi.fn().mockResolvedValue({
        data: bindData,
        error: null,
      }),
      signUp: vi.fn(),
    }
    const { core, fetchUser } = createPasswordCore({
      auth,
      user: createTestUser({ id: uid }),
    })

    const { bindEmail, verifyBindEmail } = useTcbPassword(core)
    await expect(bindEmail(email)).resolves.toBe(bindData)
    const result = await verifyBindEmail(bindData, email, '123456')

    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ email })
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ email, token: '123456' })
    expect(result).toEqual({ user: { id: uid, email } })
    expect(result?.user.id).toBe(uid)
    expect(fetchUser).toHaveBeenCalledOnce()
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('邮箱已被其他账号绑定时返回字段级错误且不展示服务端原文', async () => {
    const providerError = {
      status: 'already_exists',
      message: 'raw provider: email identity has already been registered',
    }
    const { core, toastAdd } = createPasswordCore({
      auth: {
        updateUser: vi.fn().mockResolvedValue({ data: null, error: providerError }),
      },
    })

    const { bindEmail } = useTcbPassword(core)
    const promise = bindEmail('bound@example.com')

    await expect(promise).rejects.toBeInstanceOf(EmailBindingError)
    await expect(promise).rejects.toMatchObject({
      presentation: {
        field: 'email',
        title: '该邮箱已被使用',
        description: '该邮箱已绑定其他账号，请更换邮箱，或退出后使用该邮箱登录原账号。',
        code: 'already_exists',
      },
    })
    expect(core.error.value).toBe('该邮箱已绑定其他账号，请更换邮箱，或退出后使用该邮箱登录原账号。')
    expect(core.error.value).not.toContain('raw provider')
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('服务端拒绝邮箱格式时回填邮箱字段', async () => {
    const providerError = {
      status: 'invalid_argument',
      message: 'raw provider parameter details',
    }
    const { core, toastAdd } = createPasswordCore({
      auth: {
        updateUser: vi.fn().mockResolvedValue({ data: null, error: providerError }),
      },
    })

    const { bindEmail } = useTcbPassword(core)

    await expect(bindEmail('invalid@example.com')).rejects.toMatchObject({
      presentation: {
        field: 'email',
        title: '邮箱格式不正确',
        description: '请输入有效的邮箱地址。',
        code: 'invalid_argument',
      },
    })
    expect(core.error.value).toBe('请输入有效的邮箱地址。')
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('验证码错误或过期时返回验证码字段错误且不弹 Toast', async () => {
    const providerError = {
      status: 'invalid_verification_code',
      message: 'raw provider credential details',
    }
    const { core, toastAdd } = createPasswordCore()
    const bindData = {
      verifyOtp: vi.fn().mockResolvedValue({ data: null, error: providerError }),
    } satisfies TcbBindVerificationData

    const { verifyBindEmail } = useTcbPassword(core)
    const promise = verifyBindEmail(bindData, 'bound@example.com', '123456')

    await expect(promise).rejects.toMatchObject({
      presentation: {
        field: 'otp',
        title: '验证码无效',
        description: '验证码错误或已过期，请重新输入或获取新验证码。',
        code: 'invalid_verification_code',
      },
    })
    expect(core.error.value).toBe('验证码错误或已过期，请重新输入或获取新验证码。')
    expect(core.error.value).not.toContain('raw provider')
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('未知服务端错误只展示安全的表单级提示，不透传原始消息', async () => {
    const providerError = {
      code: 'internal_provider_failure',
      message: 'raw provider stack and tenant configuration details',
    }
    const { core, toastAdd } = createPasswordCore({
      auth: {
        updateUser: vi.fn().mockResolvedValue({ data: null, error: providerError }),
      },
    })

    const { bindEmail } = useTcbPassword(core)

    await expect(bindEmail('bound@example.com')).rejects.toMatchObject({
      presentation: {
        field: 'form',
        title: '验证码发送失败',
        description: '验证码暂时无法发送，请稍后重试。',
        code: 'internal_provider_failure',
      },
    })
    expect(core.error.value).toBe('验证码暂时无法发送，请稍后重试。')
    expect(toastAdd).toHaveBeenCalledExactlyOnceWith({
      title: '验证码发送失败',
      description: '验证码暂时无法发送，请稍后重试。',
      color: 'error',
    })
    expect(JSON.stringify(toastAdd.mock.calls)).not.toContain('raw provider')
  })

  it('限流错误提供可操作的安全提示', async () => {
    const providerError = {
      status: 'resource_exhausted',
      message: 'raw provider quota policy details',
    }
    const { core, toastAdd } = createPasswordCore({
      auth: {
        updateUser: vi.fn().mockResolvedValue({ data: null, error: providerError }),
      },
    })

    const { bindEmail } = useTcbPassword(core)

    await expect(bindEmail('bound@example.com')).rejects.toMatchObject({
      presentation: {
        field: 'form',
        title: '请求过于频繁',
        description: '验证码请求过于频繁，请稍后再试。',
        code: 'resource_exhausted',
      },
    })
    expect(toastAdd).toHaveBeenCalledExactlyOnceWith({
      title: '请求过于频繁',
      description: '验证码请求过于频繁，请稍后再试。',
      color: 'error',
    })
  })
})
