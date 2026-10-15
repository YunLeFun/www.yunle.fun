import type { AcquisitionAuthMethod, AcquisitionContext } from './acquisition'
import { readAcquisitionContext } from './acquisition'

export const ACQUISITION_ATTEMPT_TTL_MS = 30 * 60 * 1000
export const ACQUISITION_MAX_ATTEMPTS = 3
const PENDING_KEY = 'ylf:acquisition:pending:v1'
let memoryPending: PendingAcquisition | null = null
let memoryOnly = false

export interface PendingAcquisition {
  version: 1
  attemptId: string
  userId: string
  createdAt: number
  frozenAt: number
  deadlineAt: number
  authMethod: AcquisitionAuthMethod
  context: AcquisitionContext | null
  attempts: number
  nextAttemptAt: number
}

function storage() {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  }
  catch {
    return undefined
  }
}

function validatePending(input: PendingAcquisition | null, now: number): PendingAcquisition | null {
  if (!input || input.version !== 1 || !/^[\w-]{16,128}$/.test(input.attemptId)
    || typeof input.userId !== 'string' || !/^[\w:-]{1,128}$/.test(input.userId)
    || !Number.isSafeInteger(input.createdAt) || input.createdAt <= 0
    || !Number.isSafeInteger(input.frozenAt) || input.frozenAt < input.createdAt || input.frozenAt > now + 60000
    || input.deadlineAt !== input.createdAt + ACQUISITION_ATTEMPT_TTL_MS
    || !Number.isInteger(input.attempts) || input.attempts < 0 || input.attempts > ACQUISITION_MAX_ATTEMPTS
    || !Number.isSafeInteger(input.nextAttemptAt) || input.nextAttemptAt < input.frozenAt
    || !['phone_otp', 'email_otp', 'github', 'wx_open', 'unknown'].includes(input.authMethod)) {
    return null
  }
  // The attempt was captured before authentication. OAuth can cross the 30-day
  // first-touch boundary; validating at frozenAt would silently change that
  // original context and cancel even a valid registration touch.
  const context = input.context === null ? null : readAcquisitionContext(input.context, input.createdAt)
  if (input.context !== null && !context)
    return null
  return { version: 1, attemptId: input.attemptId, userId: input.userId, createdAt: input.createdAt, frozenAt: input.frozenAt, deadlineAt: input.deadlineAt, authMethod: input.authMethod, context, attempts: input.attempts, nextAttemptAt: input.nextAttemptAt }
}

export function readPendingAcquisition(now = Date.now()): PendingAcquisition | null {
  const session = storage()
  if (!session)
    return validatePending(memoryPending, now)
  let value: string | null
  try {
    value = session.getItem(PENDING_KEY)
  }
  catch {
    // Browser storage denial allows only the same document's validated fallback.
    return validatePending(memoryPending, now)
  }
  if (!value) {
    if (memoryOnly)
      return validatePending(memoryPending, now)
    memoryPending = null
    return null
  }
  try {
    const pending = validatePending(JSON.parse(value) as PendingAcquisition, now)
    memoryPending = pending
    memoryOnly = false
    return pending
  }
  catch {
    // Malformed persisted state must not resurrect a previous in-memory job.
    memoryPending = null
    memoryOnly = false
    return null
  }
}

export function writePendingAcquisition(value: PendingAcquisition) {
  memoryPending = JSON.parse(JSON.stringify(value)) as PendingAcquisition
  memoryOnly = true
  try {
    const session = storage()
    if (session) {
      session.setItem(PENDING_KEY, JSON.stringify(memoryPending))
      memoryOnly = false
    }
  }
  catch {
    // Storage denial limits recovery to this document; no credentials are stored.
  }
}

export function clearPendingAcquisition(expected?: Pick<PendingAcquisition, 'attemptId' | 'userId'>) {
  const current = readPendingAcquisition()
  if (expected && (current?.attemptId !== expected.attemptId || current.userId !== expected.userId))
    return
  memoryPending = null
  memoryOnly = false
  try {
    storage()?.removeItem(PENDING_KEY)
  }
  catch {
    // The browser denied sessionStorage; the document fallback is already cleared.
  }
}
