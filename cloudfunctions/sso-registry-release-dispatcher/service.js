/** Transactional-outbox dispatcher for approved Registry releases. */

'use strict'

const LEASE_MS = 60 * 1000
const MAX_ATTEMPTS = 5

function retryDelay(attempts) {
  return Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.max(0, attempts - 1)))
}

async function runRegistryReleaseDispatch({
  dispatchWorkflow,
  leaseOwner,
  now = Date.now(),
  store,
}) {
  if (!store || typeof dispatchWorkflow !== 'function' || typeof leaseOwner !== 'string' || !leaseOwner)
    throw new TypeError('Registry release dispatcher is not configured')
  const ready = await store.listReady(now, 10)
  const result = { claimed: 0, dispatched: 0, failed: 0, deadLetter: 0 }
  for (const candidate of ready) {
    const attempts = Number(candidate.attempts || 0) + 1
    const claimed = await store.claim(candidate.releaseIntentId, {
      attempts,
      leaseOwner,
      leaseExpiresAt: now + LEASE_MS,
      updatedAt: now,
    })
    if (!claimed)
      continue
    result.claimed++
    try {
      const dispatched = await dispatchWorkflow({ releaseIntentId: candidate.releaseIntentId })
      const marked = await store.markSent(candidate.releaseIntentId, leaseOwner, {
        attempts,
        dispatchRequestId: typeof dispatched?.requestId === 'string' ? dispatched.requestId : null,
        dispatchedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      if (marked)
        result.dispatched++
    }
    catch (error) {
      const deadLetter = attempts >= MAX_ATTEMPTS
      const marked = await store.markFailed(candidate.releaseIntentId, leaseOwner, {
        attempts,
        status: deadLetter ? 'dead_letter' : 'retry',
        nextAttemptAt: deadLetter ? null : now + retryDelay(attempts),
        lastErrorCode: typeof error?.code === 'string' ? error.code.slice(0, 128) : 'github_dispatch_failed',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      if (marked)
        result.failed++
      if (marked && deadLetter)
        result.deadLetter++
    }
  }
  return result
}

module.exports = { runRegistryReleaseDispatch }
