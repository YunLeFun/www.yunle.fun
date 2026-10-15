import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ACQUISITION_WRITE_TIMEOUT_MS, useAuthAcquisition } from '../app/composables/auth/useAcquisition'
import { useTcbOAuth } from '../app/composables/auth/useOAuth'
import { clearPendingAcquisition, readPendingAcquisition } from '../app/utils/acquisition-pending'
import { bindAcquisitionOAuthState, captureAcquisitionEntry, clearAcquisitionAttempt, currentAcquisitionAttempt, setAcquisitionAuthMethod } from '../app/utils/acquisition-storage'

const userId = 'authenticated-user'
let output: ReturnType<typeof vi.fn>
function authenticated() {
  return { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null }) } as never
}

beforeEach(() => {
  output = vi.fn()
  vi.spyOn(console, 'info').mockImplementation(output)
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
})

afterEach(() => {
  clearAcquisitionAttempt()
  clearPendingAcquisition()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('authentication acquisition recording', () => {
  it('sends only the frozen account equality guard and context; application and write subject still come from the server', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=zhihu'), '', {})
    const callFunction = vi.fn().mockResolvedValue({ result: { ok: true, status: 'recorded' } })
    await useAuthAcquisition({ callFunction } as never, authenticated()).recordAfterAuthentication('phone_otp', userId)
    expect(callFunction).toHaveBeenCalledWith({
      name: 'account-api',
      data: {
        action: 'recordUserAcquisition',
        expectedUserId: userId,
        authMethod: 'phone_otp',
        context: expect.objectContaining({ version: 1, registerTouch: expect.objectContaining({ utmSource: 'zhihu' }) }),
      },
    })
    expect(currentAcquisitionAttempt()).toBeNull()
  })

  it('leaves Registry-validated SSO application attribution to the SSO service', async () => {
    const nonce = 'a'.repeat(43)
    captureAcquisitionEntry(new URL(`/auth/sso?${new URLSearchParams({ client_id: 'cook-web', redirect_uri: 'https://cook.yunyoujun.cn/', nonce, scope: 'identity:bootstrap', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256' })}`, 'https://www.yunle.fun'), '', {})
    const callFunction = vi.fn()
    const recorder = useAuthAcquisition({ callFunction } as never, authenticated())
    await recorder.recordAfterAuthentication('github', userId)
    expect(callFunction).not.toHaveBeenCalled()
    expect(recorder.ssoAcquisition('cook-web', 'https://cook.yunyoujun.cn/', nonce)).toEqual({ acquisition: null, acquisitionAuthMethod: 'github' })
    expect(recorder.ssoAcquisition('cook-web', 'https://cook.yunyoujun.cn/', 'b'.repeat(43))).toBeUndefined()
  })

  it('keeps authentication successful and logs only a safe terminal outcome for an unknown SDK failure', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=newsletter'), '', {})
    const callFunction = vi.fn().mockRejectedValue(new Error('private provider detail'))
    await expect(useAuthAcquisition({ callFunction } as never, authenticated()).recordAfterAuthentication('github', userId)).resolves.toBeUndefined()
    expect(currentAcquisitionAttempt()).toBeNull()
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'website', trigger: 'authentication', outcome: 'terminal_failure', attempts: 1 })
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/newsletter|private|authenticated-user/)
  })

  it('clears completed attempts for idempotent or ineligible-account responses', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/'), '', {})
    const callFunction = vi.fn().mockResolvedValue({ result: { ok: true, status: 'skipped', reason: 'existing_account' } })
    await useAuthAcquisition({ callFunction } as never, authenticated()).recordAfterAuthentication('email_otp', userId)
    expect(currentAcquisitionAttempt()).toBeNull()
  })

  it('bounds a hanging write so successful authentication can continue', async () => {
    vi.useFakeTimers()
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=zhihu'), '', {})
    const callFunction = vi.fn(() => new Promise(() => {}))
    const completed = useAuthAcquisition({ callFunction } as never, authenticated()).recordAfterAuthentication('phone_otp', userId)
    await vi.advanceTimersByTimeAsync(ACQUISITION_WRITE_TIMEOUT_MS)
    await expect(completed).resolves.toBeUndefined()
    expect(currentAcquisitionAttempt()?.context?.registerTouch?.utmSource).toBe('zhihu')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the backend equality guard when the SDK token account changes between getSession and callFunction', async () => {
    vi.useFakeTimers()
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=original'), '', {})
    let actualTokenUser = userId
    const auth = { getSession: vi.fn(async () => {
      const session = { user: { id: actualTokenUser } }
      actualTokenUser = 'new-account'
      return { data: { session }, error: null }
    }) }
    const callFunction = vi.fn(async ({ data }) => ({ result: data.expectedUserId === actualTokenUser ? { ok: true, status: 'recorded' } : { ok: false, statusCode: 409, retryable: false, code: 'acquisition_account_changed' } }))
    await useAuthAcquisition({ callFunction } as never, auth as never).recordAfterAuthentication('phone_otp', userId)
    await vi.advanceTimersByTimeAsync(12000)
    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(callFunction.mock.calls[0]?.[0].data.expectedUserId).toBe(userId)
    expect(readPendingAcquisition()).toBeNull()
    expect(output).toHaveBeenCalledWith('[acquisition]', expect.objectContaining({ outcome: 'identity_changed', statusCode: 409 }))
  })

  it('recovers a transient write using the original OAuth method/context after a document refresh', async () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const store = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    vi.stubGlobal('window', { sessionStorage: store })
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=original'), '', { session: store })
    const firstCall = vi.fn().mockResolvedValue({ result: { ok: false, statusCode: 503, retryable: true } })
    await useAuthAcquisition({ callFunction: firstCall } as never, authenticated()).recordAfterAuthentication('github', userId)
    const originalPending = readPendingAcquisition()
    captureAcquisitionEntry(new URL('https://www.yunle.fun/profile'), '', { session: store })
    const secondCall = vi.fn().mockResolvedValue({ result: { ok: true, status: 'recorded' } })
    const recovered = useAuthAcquisition({ callFunction: secondCall } as never, authenticated())
    await recovered.resumeAfterSessionRecovery(userId)
    expect(secondCall).not.toHaveBeenCalled()
    // A refresh replaces the old document's timers. The pending nextAt/deadline survives.
    vi.clearAllTimers()
    await vi.advanceTimersByTimeAsync(2000)
    await recovered.resumeAfterSessionRecovery(userId, 'online')
    expect(secondCall).toHaveBeenCalledWith({ name: 'account-api', data: { action: 'recordUserAcquisition', expectedUserId: userId, authMethod: 'github', context: originalPending?.context } })
    expect(readPendingAcquisition()).toBeNull()
  })

  it('records an OAuth callback only for its original SDK state and never recaptures a replacement attempt', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=original'), '', {})
    const original = setAcquisitionAuthMethod('github')!
    expect(bindAcquisitionOAuthState(original, 'prd-github-original123')).toBe(true)
    const callFunction = vi.fn().mockResolvedValue({ result: { ok: true, status: 'recorded' } })
    const recorder = useAuthAcquisition({ callFunction } as never, authenticated())
    await recorder.recordAfterOAuthAuthentication('github', userId, 'prd-github-other123')
    await recorder.recordAfterOAuthAuthentication('github', userId, null)
    expect(callFunction).not.toHaveBeenCalled()
    captureAcquisitionEntry(new URL('https://www.yunle.fun/login?utm_source=replacement'), '', {})
    await recorder.recordAfterOAuthAuthentication('github', userId, 'prd-github-original123')
    expect(callFunction).not.toHaveBeenCalled()
    expect(currentAcquisitionAttempt()?.context?.registerTouch?.utmSource).toBe('replacement')
  })

  it('preserves a matching OAuth state through the provider callback and records its frozen source', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=original'), '', {})
    bindAcquisitionOAuthState(setAcquisitionAuthMethod('github')!, 'prd-github-original123')
    const expected = currentAcquisitionAttempt()
    const callback = captureAcquisitionEntry(new URL('https://www.yunle.fun/auth/callback?code=private&state=prd-github-original123&utm_source=github'), 'https://github.com/', {})
    expect(callback).toEqual(expected)
    const callFunction = vi.fn().mockResolvedValue({ result: { ok: true, status: 'recorded' } })
    await useAuthAcquisition({ callFunction } as never, authenticated()).recordAfterOAuthAuthentication('github', userId, 'prd-github-original123')
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authMethod: 'github', context: expected?.context }) }))
  })

  it('binds the real SDK state before redirecting and does not bind a state to a route changed during authorization setup', async () => {
    captureAcquisitionEntry(new URL('https://www.yunle.fun/?utm_source=original'), '', {})
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { origin: 'https://www.yunle.fun', assign } })
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: 'https://provider.example/authorize?state=prd-github-original123' }, error: null })
    const core = { auth: { signInWithOAuth }, router: { currentRoute: ref({ fullPath: '/login' }) }, toast: { add: vi.fn() }, loading: ref(false), error: ref(null), fetchUser: vi.fn() }
    await useTcbOAuth(core as never).loginWithGitHub()
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'github', options: { redirectTo: 'https://www.yunle.fun/auth/callback', skipBrowserRedirect: true } })
    expect(currentAcquisitionAttempt()?.oauthState).toBe('prd-github-original123')
    expect(assign).toHaveBeenCalledWith('https://provider.example/authorize?state=prd-github-original123')
    const stale = currentAcquisitionAttempt()!
    captureAcquisitionEntry(new URL('https://www.yunle.fun/login?utm_source=replacement'), '', {})
    expect(bindAcquisitionOAuthState(stale, 'prd-github-new123')).toBe(false)
    expect(currentAcquisitionAttempt()?.oauthState).toBeUndefined()
  })
})
