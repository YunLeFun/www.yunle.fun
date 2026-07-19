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

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => h.s.authSession,
}))

describe('sso bridge', () => {
  beforeEach(() => {
    const callOrder: string[] = []
    const authReady = ref(false)

    h.s.callOrder = callOrder
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
      checkAuthStatus: vi.fn(async () => {
        callOrder.push('restore-session')
        authReady.value = true
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
})
