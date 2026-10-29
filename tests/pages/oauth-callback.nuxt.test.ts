// @vitest-environment nuxt
import type { VueWrapper } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import CallbackPage from '../../app/pages/auth/callback.vue'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))

mockNuxtImport('useCloudbase', () => () => h.state.cloudbase)
mockNuxtImport('useTcbAuth', () => () => h.state.authSession)
mockNuxtImport('useAppToast', () => () => ({ add: h.state.toastAdd }))

vi.mock('~/composables/auth/useAcquisition', () => ({
  useAuthAcquisition: () => ({ recordAfterOAuthAuthentication: h.state.recordAcquisition }),
}))

let wrapper: VueWrapper | undefined

async function mount() {
  wrapper = await mountSuspended(CallbackPage, {
    route: '/auth/callback?code=oauth-code&state=prd-github-test',
    global: {
      stubs: {
        Icon: true,
        AppButton: { template: '<button><slot /></button>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  h.state.timeout = vi.spyOn(globalThis, 'setTimeout')
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/auth/callback?code=oauth-code&state=prd-github-test')
  h.state.router = useRouter()
  vi.spyOn(h.state.router, 'push').mockResolvedValue(undefined)
  h.state.toastAdd = vi.fn()
  h.state.recordAcquisition = vi.fn().mockResolvedValue(undefined)
  h.state.cloudbase = {
    app: {},
    auth: {
      grantProviderToken: vi.fn().mockResolvedValue({ provider_token: 'provider-token' }),
      signInWithProvider: vi.fn().mockResolvedValue(undefined),
      bindWithProvider: vi.fn().mockResolvedValue(undefined),
    },
  }
  h.state.authSession = {
    fetchUser: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: ref(true),
    user: ref({ id: 'user-a', nickname: '云游者' }),
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  for (const result of h.state.timeout.mock.results) {
    if (result.type === 'return')
      clearTimeout(result.value)
  }
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('oauth callback completion', () => {
  it('exposes unknown progress while waiting for the provider exchange', async () => {
    let finishExchange!: (value: { provider_token: string }) => void
    h.state.cloudbase.auth.grantProviderToken.mockReturnValue(new Promise((resolve) => {
      finishExchange = resolve
    }))
    const page = await mount()

    expect(page.find('[role="status"][aria-live="polite"]').exists()).toBe(true)
    const progress = page.find('[role="progressbar"]')
    expect(progress.attributes('aria-label')).toBe('处理中')
    expect(progress.attributes('aria-valuenow')).toBeUndefined()
    expect(progress.attributes('data-state')).toBe('indeterminate')
    expect(h.state.cloudbase.auth.signInWithProvider).not.toHaveBeenCalled()
    expect(h.state.router.push).not.toHaveBeenCalled()

    finishExchange({ provider_token: 'provider-token' })
    await flushPromises()
    expect(h.state.router.push).toHaveBeenCalledExactlyOnceWith('/profile')
  })

  it('resumes SSO immediately after the provider exchange and user restoration finish', async () => {
    const redirect = '/auth/sso?client_id=cms-web&nonce=test'
    localStorage.setItem('auth_redirect', redirect)
    sessionStorage.setItem('prd-github-test', 'pending-state')
    await mount()

    expect(h.state.cloudbase.auth.grantProviderToken).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: 'github',
      provider_code: 'oauth-code',
    }))
    expect(h.state.cloudbase.auth.signInWithProvider).toHaveBeenCalledExactlyOnceWith({ provider_token: 'provider-token' })
    expect(h.state.authSession.fetchUser).toHaveBeenCalledOnce()
    expect(h.state.recordAcquisition).toHaveBeenCalledWith('github', 'user-a', 'prd-github-test')
    expect(h.state.router.push).toHaveBeenCalledExactlyOnceWith(redirect)
    expect(localStorage.getItem('auth_redirect')).toBeNull()
    expect(sessionStorage.getItem('prd-github-test')).toBeNull()
  })

  it('returns immediately to security settings after a non-popup binding completes', async () => {
    localStorage.setItem('auth_link_provider', 'github')
    await mount()

    expect(h.state.cloudbase.auth.bindWithProvider).toHaveBeenCalledExactlyOnceWith({ provider_token: 'provider-token' })
    expect(h.state.cloudbase.auth.signInWithProvider).not.toHaveBeenCalled()
    expect(h.state.authSession.fetchUser).toHaveBeenCalledOnce()
    expect(h.state.router.push).toHaveBeenCalledExactlyOnceWith('/settings?tab=security')
    expect(h.state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: '绑定成功' }))
  })

  it('keeps failed-provider feedback visible before returning to login', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.state.cloudbase.auth.grantProviderToken.mockRejectedValue(new Error('invalid code'))
    const page = await mount()

    expect(page.text()).toContain('授权码已失效，请重新发起授权')
    expect(page.text()).toContain('返回登录页')
    expect(h.state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: '登录失败' }))
    expect(h.state.cloudbase.auth.signInWithProvider).not.toHaveBeenCalled()
    expect(h.state.router.push).not.toHaveBeenCalled()

    const redirectTimer = h.state.timeout.mock.calls.find(([, delay]: [unknown, number]) => delay === 3000)
    expect(redirectTimer).toBeDefined()
    redirectTimer[0]()
    expect(h.state.router.push).toHaveBeenCalledExactlyOnceWith('/login')
  })

  it('does not navigate before the restored user is verified', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.state.authSession.isAuthenticated.value = false
    h.state.authSession.user.value = null
    const page = await mount()

    expect(page.text()).toContain('未能获取用户信息，请重试')
    expect(h.state.recordAcquisition).not.toHaveBeenCalled()
    expect(h.state.router.push).not.toHaveBeenCalled()
  })
})
