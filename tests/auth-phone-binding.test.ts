import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useTcbPassword } from '../app/composables/auth/usePassword'

describe('phone credential binding', () => {
  const phone = '13800138000'
  const token = '123456'
  const verifyOtp = vi.fn()
  const updateUser = vi.fn()
  const fetchUser = vi.fn()
  const toastAdd = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    verifyOtp.mockResolvedValue({ data: { user: { id: 'email-user', phone } }, error: null })
    updateUser.mockResolvedValue({ data: { verifyOtp }, error: null })
    fetchUser.mockResolvedValue({ id: 'email-user', phone })
  })

  it('requests a phone change, verifies its SMS code, and refreshes the user', async () => {
    const core = {
      auth: { updateUser },
      router: { currentRoute: ref({ value: { query: {} } }) },
      toast: { add: toastAdd },
      loading: ref(false),
      error: ref<string | null>(null),
      user: ref(null),
      fetchUser,
    } as unknown as Parameters<typeof useTcbPassword>[0]
    const { bindPhone, verifyBindPhone } = useTcbPassword(core)

    const bindData = await bindPhone(phone)
    expect(updateUser).toHaveBeenCalledWith({ phone })

    await verifyBindPhone(bindData, phone, token)
    expect(verifyOtp).toHaveBeenCalledWith({ phone, token })
    expect(fetchUser).toHaveBeenCalledOnce()
    expect(toastAdd).toHaveBeenLastCalledWith({
      title: '绑定成功',
      description: '手机号已成功绑定',
      color: 'success',
    })
  })
})
