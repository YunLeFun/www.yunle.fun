import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { useTcbOtp } from '../app/composables/auth/useOtp'

type OtpCore = Parameters<typeof useTcbOtp>[0]
const verificationMethods = ['verifyPhoneOtp', 'verifyEmailOtp', 'verifySignUpOtp'] as const
const ssoRedirect = '/auth/sso?client_id=cms-web&nonce=test'

function createCore(redirect: unknown = ssoRedirect) {
  const route = shallowRef({ fullPath: '/login?redirect=test', query: { redirect } })
  const push = vi.fn()
  const fetchUser = vi.fn()
  const core = {
    auth: {},
    router: { currentRoute: route, push },
    toast: { add: vi.fn() },
    loading: shallowRef(false),
    error: shallowRef<string | null>(null),
    user: shallowRef({ id: 'test-user' }),
    fetchUser,
  } as unknown as OtpCore
  const otpData = {
    verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null }),
  }
  return { core, route, push, fetchUser, otpData }
}

describe.each(verificationMethods)('%s redirect', (method) => {
  it('resumes the original SSO request after verification', async () => {
    const { core, push, otpData } = createCore()
    await useTcbOtp(core)[method](otpData, '123456')
    expect(push).toHaveBeenCalledExactlyOnceWith(ssoRedirect)
  })

  it('does not overwrite SSO navigation already resumed by the login page', async () => {
    const { core, route, push, fetchUser, otpData } = createCore()
    fetchUser.mockImplementation(async () => {
      route.value = { fullPath: ssoRedirect, query: { redirect: undefined } }
    })
    await useTcbOtp(core)[method](otpData, '123456')
    expect(push).not.toHaveBeenCalled()
    expect(route.value.fullPath).toBe(ssoRedirect)
  })

  it.each(['https://example.com', '//example.com', '/login'])('rejects an unsafe or looping redirect: %s', async (redirect) => {
    const { core, push, otpData } = createCore(redirect)
    await useTcbOtp(core)[method](otpData, '123456')
    expect(push).toHaveBeenCalledExactlyOnceWith('/')
  })
})
