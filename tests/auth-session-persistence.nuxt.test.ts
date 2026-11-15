// @vitest-environment nuxt
import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import { useTcbAuthCore } from '../app/composables/auth/useAuthCore'
import { useServerSession } from '../app/composables/auth/useServerSession'
import authMiddleware from '../app/middleware/auth.global'

const sessionState = ref<{ user?: { uid: string, name?: string }, loggedInAt?: number } | null>(null)
const readyState = ref(true)

const h = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    setSession: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  onLogin: vi.fn(),
  onBootstrap: vi.fn(),
  onLogout: vi.fn(),
  upsertMyProfile: vi.fn(async () => true),
  refreshAccountAccess: vi.fn(async () => ({ restricted: false })),
  resumeAfterSessionRecovery: vi.fn(async () => {}),
  navigateTo: vi.fn((to: unknown) => to),
}))

registerEndpoint('/api/session/login', {
  method: 'POST',
  handler: async (event) => {
    const body = await readBody(event)
    return h.onLogin(body)
  },
})

registerEndpoint('/api/session/bootstrap', {
  method: 'POST',
  handler: () => h.onBootstrap(),
})

registerEndpoint('/api/session/logout', {
  method: 'POST',
  handler: () => h.onLogout(),
})

mockNuxtImport('useCloudbase', () => () => ({
  app: { callFunction: vi.fn() },
  auth: h.auth,
}))

mockNuxtImport('useUserSession', () => () => ({
  ready: computed(() => readyState.value),
  loggedIn: computed(() => Boolean(sessionState.value?.user)),
  user: computed(() => sessionState.value?.user || null),
  session: sessionState,
  fetch: vi.fn(async () => {}),
  clear: vi.fn(async () => { sessionState.value = null }),
  openInPopup: vi.fn(),
}))

mockNuxtImport('useAppToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useUserProfile', () => () => ({
  upsertMyProfile: h.upsertMyProfile,
  syncRestricted: ref(false),
}))
mockNuxtImport('useAccountAccess', () => () => ({
  access: ref({ restricted: false }),
  refresh: h.refreshAccountAccess,
  clear: vi.fn(),
}))
mockNuxtImport('navigateTo', () => h.navigateTo)

vi.mock('../app/composables/auth/useAcquisition', () => ({
  useAuthAcquisition: () => ({
    resumeAfterSessionRecovery: h.resumeAfterSessionRecovery,
  }),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('auth session persistence & dual-layer synchronization', () => {
  beforeEach(() => {
    const nuxtApp = useNuxtApp() as Record<string, unknown>
    nuxtApp._authCheckPromise = undefined
    nuxtApp._serverSessionQueue = undefined
    nuxtApp._serverSessionBootstrapInflight = undefined
    nuxtApp._serverSessionLastSealedPair = undefined
    nuxtApp._serverSessionEpoch = 0

    const config = useRuntimeConfig()
    config.public.cookieSession = true
    config.public.cookieSessionMemory = true

    useState<unknown>('auth_user').value = null
    useState<boolean>('auth_ready').value = false
    useState<number>('auth_epoch').value = 0
    useState<boolean>('auth_needs_onboarding').value = false
    sessionState.value = null
    readyState.value = true

    h.auth.getSession.mockReset()
    h.auth.setSession.mockReset()
    h.auth.getUser.mockReset()
    h.auth.updateUser.mockReset().mockResolvedValue({ error: null })
    h.auth.signOut.mockReset()
    h.onLogin.mockReset()
    h.onBootstrap.mockReset()
    h.onLogout.mockReset()
    h.upsertMyProfile.mockClear()
    h.refreshAccountAccess.mockClear()
    h.navigateTo.mockClear()
  })

  it('awaits cookie re-sealing after setSession rotates refresh_token and deduplicates concurrent bootstraps', async () => {
    const loginDeferred = createDeferred<{ ok: true, user: { uid: string, name: string }, loggedInAt: number }>()
    let rotatedSession: { access_token: string, refresh_token: string } | null = null

    h.auth.getSession.mockImplementation(async () => ({
      data: { session: rotatedSession },
    }))
    h.auth.setSession.mockImplementation(async () => {
      rotatedSession = { access_token: 'access-rotated', refresh_token: 'refresh-rotated' }
      return { data: { session: rotatedSession }, error: null }
    })
    h.onBootstrap.mockResolvedValue({ accessToken: 'access-old', refreshToken: 'refresh-old' })
    h.onLogin.mockImplementation(() => loginDeferred.promise)

    const { bootstrapFromCookie } = useServerSession()
    let settled = false
    const first = bootstrapFromCookie().then((result) => {
      settled = true
      return result
    })
    const second = bootstrapFromCookie()

    await vi.waitFor(() => {
      expect(h.onLogin).toHaveBeenCalledWith({
        accessToken: 'access-rotated',
        refreshToken: 'refresh-rotated',
      })
    })
    expect(settled).toBe(false)
    expect(h.auth.setSession).toHaveBeenCalledTimes(1)

    loginDeferred.resolve({
      ok: true,
      user: { uid: 'uid-1', name: '云游者' },
      loggedInAt: 1700000000000,
    })

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(settled).toBe(true)
    expect(sessionState.value?.user).toEqual({ uid: 'uid-1', name: '云游者' })
  })

  it('skips redundant /api/session/login for identical tokens and clears serverSession on logout', async () => {
    h.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'a1', refresh_token: 'r1' } },
    })
    h.onLogin.mockResolvedValue({
      ok: true,
      user: { uid: 'uid-1', name: 'Tester' },
      loggedInAt: 1700000000000,
    })
    h.onLogout.mockResolvedValue({ ok: true })

    const { setServerSession, clearServerSession } = useServerSession()

    expect(await setServerSession()).toBe(true)
    expect(await setServerSession()).toBe(true)
    expect(h.onLogin).toHaveBeenCalledTimes(1)

    await clearServerSession()
    expect(sessionState.value).toBeNull()
    expect(h.onLogout).toHaveBeenCalledTimes(1)
  })

  it('seals httpOnly cookie before flipping isAuthenticated so post-login redirect cannot abort /api/session/login', async () => {
    const events: string[] = []
    const loginDeferred = createDeferred<{ ok: true, user: { uid: string, name: string }, loggedInAt: number }>()

    h.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          user: { id: 'uid-2', username: 'alice', nickname: 'Alice', is_anonymous: false },
        },
      },
    })
    h.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'uid-2', username: 'alice', nickname: 'Alice', is_anonymous: false },
      },
      error: null,
    })
    h.onLogin.mockImplementation(() => {
      events.push('login:start')
      return loginDeferred.promise.then((res) => {
        events.push('login:done')
        return res
      })
    })

    const core = useTcbAuthCore()
    const stopWatch = watch(core.isAuthenticated, (authed) => {
      if (authed)
        events.push('redirect-triggered')
    })

    const fetchPromise = core.fetchUser()
    await vi.waitFor(() => expect(events).toEqual(['login:start']))
    expect(core.isAuthenticated.value).toBe(false)

    loginDeferred.resolve({
      ok: true,
      user: { uid: 'uid-2', name: 'Alice' },
      loggedInAt: 1700000000000,
    })
    await fetchPromise
    stopWatch()

    expect(events).toEqual(['login:start', 'login:done', 'redirect-triggered'])
    expect(core.user.value?.id).toBe('uid-2')
  })

  it('does not call bootstrapFromCookie when an active non-anonymous SDK session already exists', async () => {
    h.auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-live',
          refresh_token: 'refresh-live',
          user: { id: 'uid-3', username: 'bob', nickname: 'Bob', is_anonymous: false },
        },
      },
    })
    h.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'uid-3', username: 'bob', nickname: 'Bob', is_anonymous: false },
      },
      error: null,
    })
    h.onLogin.mockResolvedValue({
      ok: true,
      user: { uid: 'uid-3', name: 'Bob' },
      loggedInAt: 1700000000000,
    })

    const core = useTcbAuthCore()
    await core.checkAuthStatus()

    expect(h.onBootstrap).not.toHaveBeenCalled()
    expect(h.auth.setSession).not.toHaveBeenCalled()
    expect(h.onLogin).toHaveBeenCalledTimes(1)
    expect(core.user.value?.id).toBe('uid-3')
    expect(core.authReady.value).toBe(true)
  })

  it('restores session in auth.global middleware when authReady was set on a guest route and a cookie session exists', async () => {
    let sdkSession: { access_token: string, refresh_token: string, user: Record<string, unknown> } | null = null
    sessionState.value = { user: { uid: 'uid-4', name: 'Restored' } }
    useState<boolean>('auth_ready').value = true
    useState<unknown>('auth_user').value = null

    h.auth.getSession.mockImplementation(async () => ({
      data: { session: sdkSession },
    }))
    h.auth.setSession.mockImplementation(async () => {
      sdkSession = {
        access_token: 'access-4',
        refresh_token: 'refresh-4',
        user: { id: 'uid-4', username: 'restored', nickname: 'Restored', is_anonymous: false },
      }
      return { data: { session: sdkSession }, error: null }
    })
    h.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'uid-4', username: 'restored', nickname: 'Restored', is_anonymous: false },
      },
      error: null,
    })
    h.onBootstrap.mockResolvedValue({ accessToken: 'access-old-4', refreshToken: 'refresh-old-4' })
    h.onLogin.mockResolvedValue({
      ok: true,
      user: { uid: 'uid-4', name: 'Restored' },
      loggedInAt: 1700000000000,
    })

    const result = await authMiddleware(
      { path: '/profile', fullPath: '/profile', query: {} } as never,
      { path: '/', fullPath: '/', query: {} } as never,
    )

    expect(result).toBeUndefined()
    expect(h.navigateTo).not.toHaveBeenCalled()
    expect(h.auth.setSession).toHaveBeenCalledTimes(1)
    expect((useState<{ id?: string } | null>('auth_user').value)?.id).toBe('uid-4')
  })

  it('does not resurrect user or cached serverSession when logout runs during an in-flight fetchUser seal', async () => {
    const loginDeferred = createDeferred<{ ok: true, user: { uid: string, name: string }, loggedInAt: number }>()
    const rawUser = { id: 'uid-5', username: 'alice', nickname: 'Alice', is_anonymous: false }
    let sdkSession: { access_token: string, refresh_token: string, user: typeof rawUser } | null = {
      access_token: 'access-5',
      refresh_token: 'refresh-5',
      user: rawUser,
    }
    const order: string[] = []

    h.auth.getSession.mockImplementation(async () => ({ data: { session: sdkSession } }))
    h.auth.getUser.mockResolvedValue({ data: { user: rawUser }, error: null })
    h.auth.signOut.mockImplementation(async () => {
      sdkSession = null
      order.push('sdk:signOut')
    })
    h.onLogin.mockImplementation(() => {
      order.push('api:login:start')
      return loginDeferred.promise
    })
    h.onLogout.mockImplementation(async () => {
      order.push('api:logout')
      return { ok: true }
    })

    const core = useTcbAuthCore()
    core.user.value = { id: 'uid-5', login: 'alice', nickname: 'Alice' } as never

    const fetchPromise = core.fetchUser()
    await vi.waitFor(() => expect(order).toContain('api:login:start'))

    const logoutPromise = core.logout()
    await vi.waitFor(() => expect(order).toContain('sdk:signOut'))
    expect(core.isAuthenticated.value).toBe(false)

    loginDeferred.resolve({
      ok: true,
      user: { uid: 'uid-5', name: 'Alice' },
      loggedInAt: 1700000000000,
    })

    await Promise.all([fetchPromise, logoutPromise])

    expect(core.isAuthenticated.value).toBe(false)
    expect(core.user.value).toBeNull()
    expect(sessionState.value).toBeNull()
    expect(sdkSession).toBeNull()
    expect(order.indexOf('api:logout')).toBeGreaterThan(order.indexOf('api:login:start'))
  })

  it('keeps restored SDK session and retries cookie sealing if initial bootstrap seal fails transiently', async () => {
    let sdkSession: { access_token: string, refresh_token: string, user: Record<string, unknown> } | null = null
    h.auth.getSession.mockImplementation(async () => ({
      data: { session: sdkSession },
    }))
    h.auth.setSession.mockImplementation(async () => {
      sdkSession = {
        access_token: 'access-restored',
        refresh_token: 'refresh-restored',
        user: { id: 'uid-6', username: 'grace', nickname: 'Grace', is_anonymous: false },
      }
      return { data: { session: sdkSession }, error: null }
    })
    h.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'uid-6', username: 'grace', nickname: 'Grace', is_anonymous: false },
      },
      error: null,
    })
    h.onBootstrap.mockResolvedValue({ accessToken: 'access-old-6', refreshToken: 'refresh-old-6' })
    h.onLogin
      .mockRejectedValueOnce(new Error('500 internal error'))
      .mockResolvedValueOnce({ ok: true, user: { uid: 'uid-6', name: 'Grace' }, loggedInAt: 1700000000000 })

    const core = useTcbAuthCore()
    await core.checkAuthStatus()

    expect(core.authReady.value).toBe(true)
    expect(core.isAuthenticated.value).toBe(true)
    expect(core.user.value?.id).toBe('uid-6')
    expect(h.onLogin).toHaveBeenCalledTimes(2)
    expect(sessionState.value?.user).toEqual({ uid: 'uid-6', name: 'Grace' })
  })

  it('serializes slow logout before a subsequent re-login seal so late logout never wipes the new cookie', async () => {
    const logoutDeferred = createDeferred<{ ok: boolean }>()
    const order: string[] = []
    let currentSession: { access_token: string, refresh_token: string } | null = {
      access_token: 'access-old',
      refresh_token: 'refresh-old',
    }

    h.auth.getSession.mockImplementation(async () => ({ data: { session: currentSession } }))
    h.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'uid-7', username: 'henry', nickname: 'Henry', is_anonymous: false },
      },
      error: null,
    })
    h.auth.signOut.mockImplementation(async () => {
      currentSession = null
    })
    h.onLogout.mockImplementation(() => {
      order.push('logout:start')
      return logoutDeferred.promise.then((res) => {
        order.push('logout:done')
        return res
      })
    })
    h.onLogin.mockImplementation(() => {
      order.push('login:seal')
      return Promise.resolve({
        ok: true,
        user: { uid: 'uid-7', name: 'Henry' },
        loggedInAt: 1700000000001,
      })
    })

    const core = useTcbAuthCore()
    core.user.value = { id: 'uid-7', login: 'henry', nickname: 'Henry' } as never

    const logoutPromise = core.logout()
    await vi.waitFor(() => expect(order).toEqual(['logout:start']))

    // User immediately signs in again while previous /api/session/logout is still in-flight
    currentSession = { access_token: 'access-relogin', refresh_token: 'refresh-relogin' }
    const reloginPromise = core.fetchUser()

    // Flush microtasks: new seal must wait until pending logout completes
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['logout:start'])

    logoutDeferred.resolve({ ok: true })
    await Promise.all([logoutPromise, reloginPromise])

    expect(order).toEqual(['logout:start', 'logout:done', 'login:seal'])
    expect(core.isAuthenticated.value).toBe(true)
    expect(sessionState.value?.user).toEqual({ uid: 'uid-7', name: 'Henry' })
  })
})
