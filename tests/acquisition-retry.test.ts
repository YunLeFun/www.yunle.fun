import type { PendingAcquisition } from '../app/utils/acquisition-pending'
import type { AcquisitionOutcomeLog } from '../app/utils/acquisition-retry'
import type { AcquisitionAttempt } from '../app/utils/acquisition-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAcquisitionTouch } from '../app/utils/acquisition'
import { ACQUISITION_ATTEMPT_TTL_MS, clearPendingAcquisition, readPendingAcquisition, writePendingAcquisition } from '../app/utils/acquisition-pending'
import { ACQUISITION_WRITE_TIMEOUT_MS, acquisitionRetryDelay, createAcquisitionRetry } from '../app/utils/acquisition-retry'

const now = Date.UTC(2026, 9, 9, 8)
const controllers: ReturnType<typeof createAcquisitionRetry>[] = []
function attempt(source = 'original', createdAt = Date.now()): AcquisitionAttempt {
  const touch = captureAcquisitionTouch(new URL(`https://www.yunle.fun/?utm_source=${source}`), '', createdAt)
  return { attemptId: `attempt-${source}-1234567890`, createdAt, authMethod: 'github', sso: null, context: { version: 1, firstTouch: touch, registerTouch: touch } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function harness(initial = attempt(), random = vi.fn(() => 1)) {
  let current: AcquisitionAttempt | null = initial
  let pending: PendingAcquisition | null = null
  const log = vi.fn<(event: AcquisitionOutcomeLog) => void>()
  const send = vi.fn<(value: PendingAcquisition) => Promise<unknown>>().mockResolvedValue({ ok: true, status: 'recorded' })
  const authenticatedUid = vi.fn<() => Promise<string | null>>().mockResolvedValue('user-original')
  const controller = createAcquisitionRetry({
    now: Date.now,
    random,
    currentAttempt: () => current,
    readPending: () => pending,
    writePending: (value) => { pending = structuredClone(value) },
    clearPending: (expected) => {
      if (pending?.attemptId === expected.attemptId && pending.userId === expected.userId)
        pending = null
    },
    clearAttempt: (expected) => {
      if (current?.attemptId === expected.attemptId && current.authMethod === expected.authMethod && JSON.stringify(current.context) === JSON.stringify(expected.context))
        current = null
    },
    authenticatedUid,
    send,
    log,
  })
  controllers.push(controller)
  return {
    controller,
    random,
    send,
    authenticatedUid,
    log,
    get pending() { return pending },
    get current() { return current },
    replace: (value: AcquisitionAttempt | null) => { current = value },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  clearPendingAcquisition()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('finite attribution retries', () => {
  it.each([
    [1, 0, 0],
    [1, 0.5, 1000],
    [1, 1, 2000],
    [2, 0, 0],
    [2, 0.5, 5000],
    [2, 1, 10000],
    [1, Number.NaN, 2000],
    [2, Number.POSITIVE_INFINITY, 10000],
    [1, -0.1, 2000],
    [2, 1.1, 10000],
  ])('bounds integer full jitter after attempt %i for entropy %s', (count, sample, expected) => {
    expect(acquisitionRetryDelay(count, () => sample)).toBe(expected)
  })

  it('uses a conservative cap for throwing entropy and never samples after the final attempt', () => {
    expect(acquisitionRetryDelay(1, () => {
      throw new Error('entropy unavailable')
    })).toBe(2000)
    const random = vi.fn(() => 0.5)
    expect(acquisitionRetryDelay(0, random)).toBe(0)
    expect(acquisitionRetryDelay(3, random)).toBe(0)
    expect(acquisitionRetryDelay(Number.NaN, random)).toBe(0)
    expect(random).not.toHaveBeenCalled()
  })

  it('persists one sampled nextAt and recovery events never reroll its delay', async () => {
    const random = vi.fn(() => 0.25)
    const original = attempt()
    const h = harness(original, random)
    h.send.mockResolvedValueOnce({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    expect(h.pending?.nextAttemptAt).toBe(now + 500)
    await h.controller.resume('online')
    await h.controller.resume('session_recovery')
    expect(h.pending?.nextAttemptAt).toBe(now + 500)
    expect(random).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(h.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('retries network and explicitly retryable 503 at most three times with the frozen account/source/deadline', async () => {
    const original = attempt()
    const h = harness(original)
    h.send.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: false, statusCode: 503, retryable: true }).mockResolvedValueOnce({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    expect(h.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(h.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.send).toHaveBeenCalledTimes(3)
    for (const [sent] of h.send.mock.calls) {
      expect(sent).toMatchObject({ userId: 'user-original', context: original.context, authMethod: 'github', deadlineAt: now + ACQUISITION_ATTEMPT_TTL_MS, createdAt: now })
    }
    expect(h.pending).toBeNull()
    expect(h.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { ok: false, statusCode: 400, retryable: false },
    { ok: false, statusCode: 401, retryable: false },
    { ok: false, statusCode: 403, retryable: true },
    { ok: false, statusCode: 409, retryable: false },
    { ok: false, statusCode: 503, retryable: false },
    { ok: false, statusCode: 503 },
    { ok: true, status: 'existing' },
    { ok: true, status: 'skipped', reason: 'existing_account' },
  ])('stops after a terminal response %j', async (reply) => {
    const original = attempt()
    const h = harness(original)
    h.send.mockResolvedValue(reply)
    await h.controller.start(original, 'user-original')
    await vi.advanceTimersByTimeAsync(12000)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.pending).toBeNull()
    expect(h.current).toBeNull()
  })

  it('does not classify an arbitrary error message or unspecified server exception as a retryable network failure', async () => {
    const original = attempt()
    const h = harness(original)
    h.send.mockRejectedValue(new Error('private SDK credentials'))
    await h.controller.start(original, 'user-original')
    expect(h.pending).toBeNull()
    expect(h.log.mock.calls.flat()).toEqual([{ surface: 'website', trigger: 'authentication', outcome: 'terminal_failure', attempts: 1 }])
  })

  it('rechecks account identity before sending and never rebinds an existing job to a later account', async () => {
    const original = attempt()
    const h = harness(original)
    h.send.mockResolvedValue({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    await h.controller.start(original, 'user-other')
    await vi.advanceTimersByTimeAsync(12000)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.pending).toBeNull()
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'identity_changed' }))
  })

  it('stops recovery before sending when the actual SDK session has changed', async () => {
    const original = attempt()
    const h = harness(original)
    h.send.mockResolvedValueOnce({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    h.authenticatedUid.mockResolvedValue('user-other')
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.pending).toBeNull()
  })

  it('retains the original 30-minute limit when recovering near expiry and does not retry beyond it', async () => {
    const original = attempt('old', now - ACQUISITION_ATTEMPT_TTL_MS + 1000)
    const h = harness(original)
    h.send.mockResolvedValue({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    expect(h.pending?.deadlineAt).toBe(now + 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.pending).toBeNull()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'expired' }))
  })

  it('bounds a slow identity lookup plus write to 1.5 seconds and keeps one flight until completion', async () => {
    const original = attempt()
    const h = harness(original)
    const identity = deferred<string | null>()
    const write = deferred<unknown>()
    h.authenticatedUid.mockReturnValue(identity.promise)
    h.send.mockReturnValue(write.promise)
    const first = h.controller.start(original, 'user-original')
    await vi.advanceTimersByTimeAsync(ACQUISITION_WRITE_TIMEOUT_MS)
    await expect(first).resolves.toBeUndefined()
    await h.controller.resume('online')
    await h.controller.resume('session_recovery')
    expect(h.authenticatedUid).toHaveBeenCalledTimes(1)
    expect(h.send).not.toHaveBeenCalled()
    identity.resolve('user-original')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.send).toHaveBeenCalledTimes(1)
    write.resolve({ ok: true, status: 'recorded' })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.pending).toBeNull()
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'recorded', late: true }))
  })

  it('retries a late transient completion after timeout without parallel requests', async () => {
    const original = attempt()
    const h = harness(original)
    const write = deferred<unknown>()
    h.send.mockReturnValueOnce(write.promise)
    const initial = h.controller.start(original, 'user-original')
    await vi.advanceTimersByTimeAsync(1500)
    await initial
    expect(h.random).toHaveBeenCalledTimes(1)
    await h.controller.resume('online')
    expect(h.send).toHaveBeenCalledTimes(1)
    write.reject(new TypeError('Failed to fetch'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.pending).toBeNull()
    expect(h.random).toHaveBeenCalledTimes(1)
  })

  it('does not let a late 409 from an old SDK request clear or write a newer account attempt', async () => {
    const original = attempt()
    const h = harness(original)
    const oldWrite = deferred<unknown>()
    h.send.mockReturnValueOnce(oldWrite.promise)
    const initial = h.controller.start(original, 'user-original')
    await vi.advanceTimersByTimeAsync(1500)
    await initial
    const next = attempt('new')
    h.replace(next)
    h.authenticatedUid.mockResolvedValue('user-other')
    await h.controller.start(next, 'user-other')
    expect(h.pending).toMatchObject({ userId: 'user-other', context: next.context, attempts: 0 })
    oldWrite.resolve({ ok: false, statusCode: 409, retryable: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.send.mock.calls[1]?.[0]).toMatchObject({ userId: 'user-other', context: next.context })
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'stale_result', late: true }))
  })

  it('preserves a newer route or SSO attempt when an older request completes', async () => {
    const original = attempt()
    const h = harness(original)
    const write = deferred<unknown>()
    h.send.mockReturnValue(write.promise)
    const initial = h.controller.start(original, 'user-original')
    await vi.advanceTimersByTimeAsync(1500)
    await initial
    const sso = { ...attempt('sso'), sso: { clientId: 'cook-web', redirectUri: 'https://cook.yunyoujun.cn/', nonce: 'a'.repeat(43) } }
    h.replace(sso)
    write.resolve({ ok: true, status: 'recorded' })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.pending).toBeNull()
    expect(h.current).toEqual(sso)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('requires the same method and source before resuming a transient failure', async () => {
    const original = attempt()
    const h = harness(original)
    h.send.mockResolvedValue({ ok: false, statusCode: 503, retryable: true })
    await h.controller.start(original, 'user-original')
    h.replace({ ...original, authMethod: 'phone_otp' })
    await h.controller.resume('session_recovery')
    expect(h.pending).toBeNull()
    expect(h.current?.authMethod).toBe('phone_otp')
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})

describe('token-free pending storage', () => {
  function storage() {
    const values = new Map<string, string>()
    return {
      values,
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
  }
  function job(): PendingAcquisition {
    const original = attempt()
    return { version: 1, attemptId: original.attemptId!, userId: 'user-original', createdAt: now, frozenAt: now, deadlineAt: now + ACQUISITION_ATTEMPT_TTL_MS, authMethod: 'github', context: original.context, attempts: 1, nextAttemptAt: now + 2000 }
  }

  it('resumes only validated fields and never revives memory when readable storage is empty or malformed', () => {
    const session = storage()
    vi.stubGlobal('window', { sessionStorage: session })
    const original = job()
    writePendingAcquisition(original)
    expect(readPendingAcquisition()).toEqual(original)
    session.values.clear()
    expect(readPendingAcquisition()).toBeNull()
    writePendingAcquisition(original)
    session.setItem('ylf:acquisition:pending:v1', '{broken')
    expect(readPendingAcquisition()).toBeNull()
    const availableGet = session.getItem
    session.getItem = () => {
      throw new Error('denied after corruption')
    }
    expect(readPendingAcquisition()).toBeNull()
    session.getItem = availableGet
    session.setItem('ylf:acquisition:pending:v1', JSON.stringify({ ...original, access_token: 'secret', context: { ...original.context, secret: 'raw' } }))
    expect(JSON.stringify(readPendingAcquisition())).not.toMatch(/secret|token|raw/)
  })

  it('rejects reset deadlines, excess attempts and malformed context instead of restoring them', () => {
    const session = storage()
    vi.stubGlobal('window', { sessionStorage: session })
    for (const changes of [{ deadlineAt: now + ACQUISITION_ATTEMPT_TTL_MS + 1 }, { attempts: 4 }, { context: { version: 2 } }, { frozenAt: now + 60001 }]) {
      session.setItem('ylf:acquisition:pending:v1', JSON.stringify({ ...job(), ...changes }))
      expect(readPendingAcquisition()).toBeNull()
    }
  })

  it('validates the document fallback again if storage is denied and keeps a frozen first touch across the 30-day boundary', () => {
    vi.stubGlobal('window', {
      get sessionStorage() { throw new Error('denied') },
    })
    const original = job()
    const first = captureAcquisitionTouch(new URL('https://www.yunle.fun/?utm_source=first'), '', now - 30 * 86400000 + 1000)
    original.context = { version: 1, firstTouch: first, registerTouch: original.context!.registerTouch }
    writePendingAcquisition(original)
    expect(readPendingAcquisition(now + 2000)?.context).toEqual(original.context)
    writePendingAcquisition({ ...original, attempts: 9 })
    expect(readPendingAcquisition()).toBeNull()
  })

  it('preserves a first touch that crosses the 30-day boundary while OAuth is completing', () => {
    const session = storage()
    vi.stubGlobal('window', { sessionStorage: session })
    const original = job()
    const first = captureAcquisitionTouch(new URL('https://www.yunle.fun/?utm_source=first'), '', now - 30 * 86400000 + 1000)
    original.context = { version: 1, firstTouch: first, registerTouch: original.context!.registerTouch }
    original.frozenAt = now + 2000
    original.nextAttemptAt = now + 4000
    writePendingAcquisition(original)
    expect(readPendingAcquisition(now + 3000)?.context).toEqual(original.context)
  })

  it('clears only the original matching pending identity', () => {
    const session = storage()
    vi.stubGlobal('window', { sessionStorage: session })
    writePendingAcquisition(job())
    clearPendingAcquisition({ attemptId: job().attemptId, userId: 'other-account' })
    expect(readPendingAcquisition()).toEqual(job())
    clearPendingAcquisition(job())
    expect(readPendingAcquisition()).toBeNull()
  })
})
