import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { useTcbPassword } from '../app/composables/auth/usePassword'

type PasswordCore = Parameters<typeof useTcbPassword>[0]

function createCore(redirect: unknown = '/auth/sso?client=cms&nonce=test') {
  const route = shallowRef({ fullPath: '/login?redirect=test', query: { redirect } })
  const push = vi.fn()
  const fetchUser = vi.fn()
  const core = {
    auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null }) },
    router: { currentRoute: route, push, resolve: (href: string) => ({ href }) },
    toast: { add: vi.fn() },
    loading: shallowRef(false),
    error: shallowRef<string | null>(null),
    user: shallowRef(null),
    fetchUser,
  } as unknown as PasswordCore
  return { core, route, push, fetchUser }
}

describe('password login redirect', () => {
  it('resumes the original SSO request after password login', async () => {
    const { core, push } = createCore()
    await useTcbPassword(core).signInWithPassword({ username: 'test-user', password: 'test-password' })
    expect(push).toHaveBeenCalledExactlyOnceWith('/auth/sso?client=cms&nonce=test')
  })

  it('keeps successful authentication when the destination module cannot load', async () => {
    const { core, push } = createCore('/profile?tab=apps#projects')
    const loadError = new TypeError('Failed to fetch dynamically imported module')
    push.mockRejectedValueOnce(loadError)

    const result = useTcbPassword(core).signInWithPassword({ username: 'test-user', password: 'test-password' })
    await expect(result).resolves.toEqual({ user: { id: 'test-user' } })

    expect(core.error.value).toBeNull()
    expect(vi.mocked(core.toast.add).mock.calls.map(([toast]) => toast.title)).toEqual(['登录成功', '页面加载失败'])
    expect(core.toast.add).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { label: '重新打开页面', href: '/profile?tab=apps#projects' },
    }))
  })

  it('does not send an already resumed SSO flow back home', async () => {
    const { core, route, push, fetchUser } = createCore()
    fetchUser.mockImplementation(async () => {
      route.value = { fullPath: '/auth/sso?client=cms&nonce=test', query: { redirect: undefined } }
    })
    await useTcbPassword(core).signInWithPassword({ username: 'test-user', password: 'test-password' })
    expect(push).not.toHaveBeenCalled()
    expect(route.value.fullPath).toBe('/auth/sso?client=cms&nonce=test')
  })

  it.each(['https://example.com', '//example.com', '/login'])('rejects an unsafe or looping redirect: %s', async (redirect) => {
    const { core, push } = createCore(redirect)
    await useTcbPassword(core).signInWithPassword({ username: 'test-user', password: 'test-password' })
    expect(push).toHaveBeenCalledExactlyOnceWith('/')
  })
})
