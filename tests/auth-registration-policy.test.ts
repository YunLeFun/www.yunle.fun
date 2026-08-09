import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useTcbOtp } from '../app/composables/auth/useOtp'

type OtpCore = Parameters<typeof useTcbOtp>[0]

function createCore() {
  const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null })
  const core = {
    auth: { signInWithOtp },
    router: { currentRoute: ref({ query: {} }), push: vi.fn() },
    toast: { add: vi.fn() },
    loading: ref(false),
    error: ref<string | null>(null),
    fetchUser: vi.fn(),
  } as unknown as OtpCore

  return { core, signInWithOtp }
}

describe('passwordless registration policy', () => {
  it('creates first-time phone users but keeps email OTP login existing-user only', async () => {
    const { core, signInWithOtp } = createCore()
    const { sendEmailOtp, sendPhoneOtp } = useTcbOtp(core)

    await sendPhoneOtp('13800138000')
    await sendEmailOtp('bound@example.com')

    expect(signInWithOtp.mock.calls).toEqual([
      [{ phone: '13800138000', options: { shouldCreateUser: true } }],
      [{ email: 'bound@example.com', options: { shouldCreateUser: false } }],
    ])
  })
})
