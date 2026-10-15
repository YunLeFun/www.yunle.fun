import type { PendingAcquisition } from './acquisition-pending'
import type { AcquisitionAttempt } from './acquisition-storage'
import { ACQUISITION_ATTEMPT_TTL_MS, ACQUISITION_MAX_ATTEMPTS } from './acquisition-pending'

export const ACQUISITION_WRITE_TIMEOUT_MS = 1500
export const ACQUISITION_RETRY_DELAYS_MS = [2000, 10000] as const

/** Full jitter within the existing two retry caps; invalid entropy keeps the cap. */
export function acquisitionRetryDelay(attempts: number, random: () => number = Math.random): number {
  const cap = ACQUISITION_RETRY_DELAYS_MS[attempts - 1]
  if (cap === undefined)
    return 0
  try {
    const sample = random()
    return Number.isFinite(sample) && sample >= 0 && sample <= 1
      ? Math.min(cap, Math.floor(sample * (cap + 1)))
      : cap
  }
  catch {
    return cap
  }
}

export type AcquisitionRetryTrigger = 'authentication' | 'session_recovery' | 'online' | 'scheduled_retry'
type OutcomeName = 'recorded' | 'existing' | 'skipped' | 'completed' | 'timeout' | 'network' | 'retryable_failure' | 'terminal_failure' | 'identity_changed' | 'identity_unavailable' | 'attempt_changed' | 'expired' | 'exhausted' | 'stale_result'
interface Outcome { outcome: OutcomeName, retryable: boolean, statusCode?: number }
export interface AcquisitionOutcomeLog { surface: 'website', trigger: AcquisitionRetryTrigger, outcome: OutcomeName, attempts: number, statusCode?: number, late?: boolean }

interface RetryEnvironment {
  now: () => number
  random?: () => number
  currentAttempt: () => AcquisitionAttempt | null
  readPending: () => PendingAcquisition | null
  writePending: (value: PendingAcquisition) => void
  clearPending: (expected: PendingAcquisition) => void
  clearAttempt: (expected: AcquisitionAttempt) => void
  authenticatedUid: () => Promise<string | null>
  send: (pending: PendingAcquisition) => Promise<unknown>
  log: (event: AcquisitionOutcomeLog) => void
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function resultOutcome(value: unknown): Outcome {
  const input = object(value)
  if (input?.ok === true) {
    const outcome = ['recorded', 'existing', 'skipped'].includes(String(input.status)) ? input.status as 'recorded' | 'existing' | 'skipped' : 'completed'
    return { outcome, retryable: false }
  }
  const statusCode = [400, 401, 403, 409, 503].includes(Number(input?.statusCode)) ? Number(input?.statusCode) : undefined
  if (statusCode === 409)
    return { outcome: 'identity_changed', retryable: false, statusCode }
  const retryable = statusCode === 503 && input?.retryable === true
  return { outcome: retryable ? 'retryable_failure' : 'terminal_failure', retryable, ...(statusCode ? { statusCode } : {}) }
}

function errorOutcome(error: unknown): Outcome {
  const input = object(error)
  const statusCode = Number(input?.statusCode || input?.status)
  if ([400, 401, 403, 409, 503].includes(statusCode))
    return resultOutcome({ statusCode, retryable: statusCode === 503 && input?.retryable === true })
  const networkCodes = ['NETWORK_ERROR', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN']
  const networkMessages = ['Failed to fetch', 'Network request failed', 'Load failed', 'NetworkError when attempting to fetch resource.', 'The Internet connection appears to be offline.']
  if (networkCodes.includes(String(input?.code)) || (input?.name === 'TypeError' && networkMessages.includes(String(input.message))))
    return { outcome: 'network', retryable: true }
  return { outcome: 'terminal_failure', retryable: false }
}

function matches(pending: PendingAcquisition, attempt: AcquisitionAttempt | null) {
  return attempt && !attempt.sso && attempt.attemptId === pending.attemptId && attempt.createdAt === pending.createdAt
    && attempt.authMethod === pending.authMethod && JSON.stringify(attempt.context) === JSON.stringify(pending.context)
}

function originalAttempt(pending: PendingAcquisition): AcquisitionAttempt {
  return { attemptId: pending.attemptId, createdAt: pending.createdAt, authMethod: pending.authMethod, context: pending.context, sso: null }
}

/** One browser document owns at most one SDK request, including after timeout. */
export function createAcquisitionRetry(environment: RetryEnvironment) {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let flight: { pending: PendingAcquisition, promise: Promise<Outcome>, timedOut: boolean } | undefined

  function log(pending: PendingAcquisition, trigger: AcquisitionRetryTrigger, outcome: Outcome, late = false) {
    environment.log({ surface: 'website', trigger, outcome: outcome.outcome, attempts: pending.attempts, ...(outcome.statusCode ? { statusCode: outcome.statusCode } : {}), ...(late ? { late: true } : {}) })
  }

  function stop(pending: PendingAcquisition, trigger: AcquisitionRetryTrigger, outcome: Outcome) {
    environment.clearPending(pending)
    environment.clearAttempt(originalAttempt(pending))
    log(pending, trigger, outcome)
  }

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    const pending = environment.readPending()
    if (disposed || !pending || flight)
      return
    if (environment.now() >= pending.deadlineAt || pending.attempts >= ACQUISITION_MAX_ATTEMPTS) {
      stop(pending, 'scheduled_retry', { outcome: environment.now() >= pending.deadlineAt ? 'expired' : 'exhausted', retryable: false })
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      void resume('scheduled_retry')
    }, Math.max(0, Math.min(pending.nextAttemptAt, pending.deadlineAt) - environment.now()))
  }

  function settle(pending: PendingAcquisition, trigger: AcquisitionRetryTrigger, outcome: Outcome, late: boolean) {
    if (disposed)
      return
    const current = environment.readPending()
    if (current?.attemptId !== pending.attemptId || current.userId !== pending.userId) {
      log(pending, trigger, { outcome: 'stale_result', retryable: false }, late)
      return
    }
    if (!matches(pending, environment.currentAttempt())) {
      environment.clearPending(pending)
      log(pending, trigger, { outcome: 'attempt_changed', retryable: false }, late)
      return
    }
    log(pending, trigger, outcome, late)
    if (!outcome.retryable) {
      environment.clearPending(pending)
      environment.clearAttempt(originalAttempt(pending))
      return
    }
    if (environment.now() >= pending.deadlineAt || pending.attempts >= ACQUISITION_MAX_ATTEMPTS) {
      stop(pending, trigger, { outcome: environment.now() >= pending.deadlineAt ? 'expired' : 'exhausted', retryable: false })
      return
    }
    // A timed-out flight already persisted its sampled recovery time. Its late
    // failure must not draw again or postpone the same retry on every restore.
    environment.writePending({ ...pending, nextAttemptAt: late ? current.nextAttemptAt : environment.now() + acquisitionRetryDelay(pending.attempts, environment.random) })
  }

  async function execute(pending: PendingAcquisition): Promise<Outcome> {
    try {
      const uid = await environment.authenticatedUid()
      if (!uid)
        return { outcome: 'identity_unavailable', retryable: false }
      if (uid !== pending.userId)
        return { outcome: 'identity_changed', retryable: false }
      if (!matches(pending, environment.currentAttempt()))
        return { outcome: 'attempt_changed', retryable: false }
      if (environment.now() >= pending.deadlineAt)
        return { outcome: 'expired', retryable: false }
      return resultOutcome(await environment.send(pending))
    }
    catch (error) {
      return errorOutcome(error)
    }
  }

  async function resume(trigger: AcquisitionRetryTrigger): Promise<void> {
    const pending = environment.readPending()
    if (disposed || !pending || flight)
      return
    if (!matches(pending, environment.currentAttempt())) {
      environment.clearPending(pending)
      log(pending, trigger, { outcome: 'attempt_changed', retryable: false })
      return
    }
    if (environment.now() >= pending.deadlineAt || pending.attempts >= ACQUISITION_MAX_ATTEMPTS) {
      stop(pending, trigger, { outcome: environment.now() >= pending.deadlineAt ? 'expired' : 'exhausted', retryable: false })
      return
    }
    if (pending.nextAttemptAt > environment.now()) {
      schedule()
      return
    }
    clearTimeout(timer)
    // Before an outcome exists, a reload uses a conservative recovery checkpoint.
    // The first actual transient failure/timeout replaces it with one jitter sample.
    const snapshot = { ...pending, attempts: pending.attempts + 1, nextAttemptAt: environment.now() + ACQUISITION_WRITE_TIMEOUT_MS + (ACQUISITION_RETRY_DELAYS_MS[pending.attempts] || 0) }
    environment.writePending(snapshot)
    const active = { pending: snapshot, promise: execute(snapshot), timedOut: false }
    flight = active
    const completed = active.promise.then((outcome) => {
      settle(snapshot, trigger, outcome, active.timedOut)
    }).finally(() => {
      if (flight === active)
        flight = undefined
      schedule()
    })
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(() => {
        active.timedOut = true
        log(snapshot, trigger, { outcome: 'timeout', retryable: true })
        const current = environment.readPending()
        if (snapshot.attempts < ACQUISITION_MAX_ATTEMPTS && environment.now() < snapshot.deadlineAt
          && current?.attemptId === snapshot.attemptId && current.userId === snapshot.userId
          && matches(snapshot, environment.currentAttempt())) {
          environment.writePending({ ...current, nextAttemptAt: environment.now() + acquisitionRetryDelay(snapshot.attempts, environment.random) })
        }
        resolve()
      }, Math.max(0, Math.min(ACQUISITION_WRITE_TIMEOUT_MS, snapshot.deadlineAt - environment.now())))
    })
    await Promise.race([completed, deadline])
    clearTimeout(deadlineTimer)
  }

  async function start(attempt: AcquisitionAttempt, userId: string): Promise<void> {
    if (disposed || attempt.sso || !attempt.attemptId || !/^[\w:-]{1,128}$/.test(userId))
      return
    const existing = environment.readPending()
    if (existing) {
      if (existing.attemptId === attempt.attemptId) {
        if (existing.userId !== userId || !matches(existing, attempt)) {
          stop(existing, 'authentication', { outcome: existing.userId !== userId ? 'identity_changed' : 'attempt_changed', retryable: false })
          return
        }
        return resume('authentication')
      }
      environment.clearPending(existing)
    }
    const now = environment.now()
    environment.writePending({ version: 1, attemptId: attempt.attemptId, userId, createdAt: attempt.createdAt, frozenAt: now, deadlineAt: attempt.createdAt + ACQUISITION_ATTEMPT_TTL_MS, authMethod: attempt.authMethod, context: JSON.parse(JSON.stringify(attempt.context)) as PendingAcquisition['context'], attempts: 0, nextAttemptAt: now })
    await resume('authentication')
  }

  function dispose() {
    disposed = true
    clearTimeout(timer)
    timer = undefined
  }
  return { start, resume, dispose }
}
