// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import SsoPage from '../../app/pages/auth/sso.vue'

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
}))

mockNuxtImport('useCloudbase', () => () => h.state.cloudbase)
mockNuxtImport('navigateTo', () => (...args: unknown[]) => h.state.navigateTo(...args))
mockNuxtImport('useAccountAccess', () => () => h.state.accountAccess)

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.state.authSession ?? {
    authReady: { value: true },
    authStatus: { value: 'guest' },
    isAuthenticated: { value: false },
    user: { value: null },
    checkAuthStatus: async () => undefined,
  },
}))

function requestRoute(overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: 'cms-web',
    redirect_uri: 'https://cms.yunle.fun/',
    scope: 'identity:bootstrap',
    nonce: 'n'.repeat(43),
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  })
  return `/auth/sso?${query.toString()}`
}

async function mount(route = requestRoute()) {
  const wrapper = await mountSuspended(SsoPage, {
    route,
    global: {
      stubs: {
        UIcon: { template: '<span />' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('sSO v3 Provider page', () => {
  beforeEach(() => {
    const callOrder: string[] = []
    const authReady = ref(false)
    const authStatus = ref<'pending' | 'authenticated' | 'guest'>('pending')

    h.state.callOrder = callOrder
    h.state.navigateTo = vi.fn()
    h.state.accountAccess = {
      access: ref({ state: 'active', restricted: false }),
      refresh: vi.fn(async () => undefined),
    }
    h.state.cloudbase = {
      auth: {
        getSession: vi.fn(async () => {
          callOrder.push('get-session')
          return {
            data: { session: { user: { id: 'user-1', is_anonymous: false } } },
            error: null,
          }
        }),
      },
      app: {
        callFunction: vi.fn(async () => {
          callOrder.push('issue-code')
          return h.state.functionResponse
        }),
      },
    }
    h.state.functionResponse = { ok: true, code: 'b'.repeat(43) }
    h.state.authSession = {
      authReady,
      authStatus,
      isAuthenticated: computed(() => authStatus.value === 'authenticated'),
      user: ref({
        id: 'user-1',
        login: 'yunyou',
        nickname: '云游君',
        avatar: '/avatar.png',
      }),
      logout: vi.fn(async () => undefined),
      checkAuthStatus: vi.fn(async () => {
        callOrder.push('restore-session')
        authReady.value = true
        authStatus.value = 'authenticated'
      }),
    }
  })

  it('restores the session, then issues a redirect-only code with every binding', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()

    expect(h.state.callOrder).toEqual(['restore-session', 'get-session', 'issue-code'])
    expect(h.state.cloudbase.app.callFunction).toHaveBeenCalledWith({
      name: 'sso-ticket',
      data: {
        action: 'issueSsoCode',
        clientId: 'cms-web',
        mode: 'redirect',
        targetOrigin: 'https://cms.yunle.fun',
        returnUrl: 'https://cms.yunle.fun/',
        scope: 'identity:bootstrap',
        nonce: 'n'.repeat(43),
        codeChallenge: 'a'.repeat(43),
        codeChallengeMethod: 'S256',
      },
    })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('shows the current account and waits for confirmation when account selection is requested', async () => {
    const wrapper = await mount(requestRoute({ prompt: 'select_account' }))

    expect(wrapper.text()).toContain('云游君')
    expect(wrapper.text()).toContain('@yunyou')
    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="sso-continue-current-account"]').trigger('click')
    await flushPromises()

    expect(h.state.cloudbase.app.callFunction).toHaveBeenCalledTimes(1)
  })

  it('honors consent without offering a Provider account switch', async () => {
    const wrapper = await mount(requestRoute({ prompt: 'consent' }))

    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="sso-continue-current-account"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sso-use-other-account"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sso-deny-authorization"]').exists()).toBe(true)
  })

  it('returns an explicit denial without issuing a code', async () => {
    const wrapper = await mount(requestRoute({ prompt: 'consent' }))

    await wrapper.get('[data-testid="sso-deny-authorization"]').trigger('click')
    await flushPromises()

    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已取消授权')
  })

  it('clears the current Provider session before logging in with another account', async () => {
    const wrapper = await mount(requestRoute({ prompt: 'select_account' }))

    await wrapper.get('[data-testid="sso-use-other-account"]').trigger('click')
    await flushPromises()

    expect(h.state.authSession.logout).toHaveBeenCalledTimes(1)
    const destination = h.state.navigateTo.mock.calls.at(-1)?.[0]
    expect(destination.path).toBe('/login')
    const preserved = new URL(destination.query.redirect, 'https://www.yunle.fun')
    expect(preserved.pathname).toBe('/auth/sso')
    expect(preserved.searchParams.get('prompt')).toBe('select_account')
    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
  })

  it('accepts the CloudBase SDK result envelope without changing protocol semantics', async () => {
    h.state.functionResponse = { result: { ok: true, code: 'c'.repeat(43) } }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()
    expect(h.state.callOrder).toEqual(['restore-session', 'get-session', 'issue-code'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('routes an unauthenticated valid request through login with the exact request preserved', async () => {
    h.state.authSession.checkAuthStatus.mockImplementation(async () => {
      h.state.callOrder.push('restore-session')
      h.state.authSession.authReady.value = true
      h.state.authSession.authStatus.value = 'guest'
    })
    const route = requestRoute()
    await mount(route)

    expect(h.state.navigateTo).toHaveBeenCalledTimes(1)
    const destination = h.state.navigateTo.mock.calls[0][0]
    expect(destination.path).toBe('/login')
    const preserved = new URL(destination.query.redirect, 'https://www.yunle.fun')
    expect(preserved.pathname).toBe('/auth/sso')
    expect(Object.fromEntries(preserved.searchParams)).toEqual({
      client_id: 'cms-web',
      redirect_uri: 'https://cms.yunle.fun/',
      scope: 'identity:bootstrap',
      nonce: 'n'.repeat(43),
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    })
    expect(h.state.cloudbase.auth.getSession).not.toHaveBeenCalled()
  })

  it('rejects every legacy, implicit, or scope-less request before calling the function', async () => {
    for (const route of [
      '/auth/sso?mode=silent&targetOrigin=https%3A%2F%2Fcms.yunle.fun',
      requestRoute({ scope: '' }),
      requestRoute({ client_id: '' }),
      requestRoute({ code_challenge_method: 'plain' }),
      requestRoute({ prompt: 'login' }),
    ]) {
      const wrapper = await mount(route)
      expect(wrapper.text()).toContain('SSO 请求参数无效')
    }
    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
  })

  it('rejects a forged native result callback before issuing a code', async () => {
    const wrapper = await mount(requestRoute({
      native_callback_uri: `yunlefun://evil/sso?state=${'s'.repeat(43)}`,
    }))

    expect(wrapper.text()).toContain('SSO 请求参数无效')
    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
  })

  it('accepts a native result callback only for explicit account selection', async () => {
    const wrapper = await mount(requestRoute({
      native_callback_uri: `yunlefun://auth/sso?state=${'s'.repeat(43)}`,
    }))

    expect(wrapper.text()).toContain('SSO 请求参数无效')
    expect(h.state.cloudbase.app.callFunction).not.toHaveBeenCalled()
  })

  it('never redirects to a callback rejected by the authoritative registry', async () => {
    h.state.functionResponse = { ok: false, reason: 'origin_not_allowed' }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = await mount(requestRoute({
      redirect_uri: 'https://evil.example/',
    }))

    expect(h.state.cloudbase.app.callFunction).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('SSO 请求未获授权')
    expect(h.state.navigateTo).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
