// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SsoPage from '../../app/pages/auth/sso.vue'

const h = vi.hoisted(() => ({
  s: {} as Record<string, any>,
}))

mockNuxtImport('useCloudbase', () => () => h.s.cloudbase)
mockNuxtImport('navigateTo', () => (...args: unknown[]) => h.s.navigateTo(...args))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.s.authSession,
}))

describe('sso bridge', () => {
  beforeEach(() => {
    const callOrder: string[] = []
    const authReady = ref(false)
    const authStatus = ref<'pending' | 'authenticated' | 'guest'>('pending')

    h.s.callOrder = callOrder
    h.s.navigateTo = vi.fn()
    h.s.cloudbase = {
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
          return h.s.functionResponse
        }),
      },
    }
    h.s.functionResponse = { ok: true, code: 'b'.repeat(43) }
    h.s.authSession = {
      authReady,
      authStatus,
      checkAuthStatus: vi.fn(async () => {
        callOrder.push('restore-session')
        authReady.value = true
        authStatus.value = 'authenticated'
      }),
    }
  })

  it('restores the server-backed CloudBase session before issuing an SSO code', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mountSuspended(SsoPage, {
      route: `/auth/sso?mode=silent&targetOrigin=${encodeURIComponent('https://cms.yunle.fun')}&nonce=1234567890abcdef1234567890abcdef&codeChallenge=${'a'.repeat(43)}&codeChallengeMethod=S256`,
      global: {
        stubs: {
          UIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    expect(h.s.authSession.checkAuthStatus).toHaveBeenCalledTimes(1)
    expect(h.s.callOrder).toEqual(['restore-session', 'get-session', 'issue-code'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('keeps compatibility with the legacy callFunction result envelope', async () => {
    h.s.functionResponse = { result: { ok: true, code: 'c'.repeat(43) } }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mountSuspended(SsoPage, {
      route: `/auth/sso?mode=silent&targetOrigin=${encodeURIComponent('https://cms.yunle.fun')}&nonce=1234567890abcdef1234567890abcdef&codeChallenge=${'a'.repeat(43)}&codeChallengeMethod=S256`,
      global: {
        stubs: {
          UIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    expect(h.s.callOrder).toEqual(['restore-session', 'get-session', 'issue-code'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('routes an unauthenticated redirect request through the login page', async () => {
    h.s.cloudbase.auth.getSession.mockResolvedValue({
      data: { session: undefined },
      error: { code: 'unauthenticated', message: 'unauthenticated' },
    })
    h.s.authSession.checkAuthStatus.mockImplementation(async () => {
      h.s.callOrder.push('restore-session')
      h.s.authSession.authReady.value = true
      h.s.authSession.authStatus.value = 'guest'
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const route = `/auth/sso?mode=redirect&targetOrigin=${encodeURIComponent('https://dao.yunle.fun')}&nonce=1234567890abcdef1234567890abcdef&codeChallenge=${'a'.repeat(43)}&codeChallengeMethod=S256&returnUrl=${encodeURIComponent('https://dao.yunle.fun/')}`

    await mountSuspended(SsoPage, {
      route,
      global: {
        stubs: {
          UIcon: { template: '<span />' },
        },
      },
    })
    await flushPromises()

    expect(h.s.navigateTo).toHaveBeenCalledTimes(1)
    const destination = h.s.navigateTo.mock.calls[0][0]
    expect(destination.path).toBe('/login')
    const preservedRequest = new URL(destination.query.redirect, 'https://www.yunle.fun')
    expect(preservedRequest.pathname).toBe('/auth/sso')
    expect(Object.fromEntries(preservedRequest.searchParams)).toEqual({
      mode: 'redirect',
      targetOrigin: 'https://dao.yunle.fun',
      nonce: '1234567890abcdef1234567890abcdef',
      codeChallenge: 'a'.repeat(43),
      codeChallengeMethod: 'S256',
      returnUrl: 'https://dao.yunle.fun/',
    })
    expect(h.s.cloudbase.auth.getSession).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
