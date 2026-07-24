/** CloudBase leasing store for reward-claim alert Outbox and short-lived rate counters. */

'use strict'

const ALERTS_COLLECTION = 'reward_claim_alerts'
const RATE_LIMITS_COLLECTION = 'reward_claim_rate_limits'
const LEASE_MS = 60_000

function row(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function rows(result) {
  return Array.isArray(result?.data) ? result.data : []
}

function isLeaseable(alert, now) {
  return (alert?.status === 'pending' && Number(alert.nextAttemptAt) <= now)
    || (alert?.status === 'sending' && Number(alert.leaseExpiresAt) <= now)
}

function createRewardClaimOpsStore(db) {
  if (!db?.command || typeof db.runTransaction !== 'function')
    throw new TypeError('CloudBase database is required')
  const command = db.command

  async function queryCandidates(now, limit) {
    const [pending, expiredLeases] = await Promise.all([
      db.collection(ALERTS_COLLECTION)
        .where({ status: 'pending', nextAttemptAt: command.lte(now) })
        .orderBy('nextAttemptAt', 'asc')
        .limit(limit)
        .get(),
      db.collection(ALERTS_COLLECTION)
        .where({ status: 'sending', leaseExpiresAt: command.lte(now) })
        .orderBy('leaseExpiresAt', 'asc')
        .limit(limit)
        .get(),
    ])
    return [...new Map(
      [...rows(pending), ...rows(expiredLeases)].map(item => [item._id, item]),
    ).values()]
      .sort((left, right) =>
        Number(left.nextAttemptAt || left.leaseExpiresAt)
        - Number(right.nextAttemptAt || right.leaseExpiresAt),
      )
      .slice(0, limit)
  }

  return {
    async leaseDue(now, workerId, limit = 20) {
      const candidates = await queryCandidates(now, limit)
      const leased = []
      for (const candidate of candidates) {
        const item = await db.runTransaction(async (transaction) => {
          const ref = transaction.collection(ALERTS_COLLECTION).doc(candidate._id)
          const current = row(await ref.get())
          if (!isLeaseable(current, now))
            return null
          const next = {
            ...current,
            status: 'sending',
            attempts: (Number(current.attempts) || 0) + 1,
            leaseOwner: workerId,
            leaseExpiresAt: now + LEASE_MS,
            updatedAt: now,
          }
          const { _id, ...fields } = next
          await ref.set(fields)
          return { _id, ...fields }
        })
        if (item)
          leased.push(item)
      }
      return leased
    },

    async markSent(id, workerId, now) {
      return db.runTransaction(async (transaction) => {
        const ref = transaction.collection(ALERTS_COLLECTION).doc(id)
        const current = row(await ref.get())
        if (current?.status !== 'sending' || current.leaseOwner !== workerId)
          return false
        await ref.update({
          status: 'sent',
          sentAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        return true
      })
    },

    async markFailed(id, workerId, now, nextAttemptAt, message) {
      return db.runTransaction(async (transaction) => {
        const ref = transaction.collection(ALERTS_COLLECTION).doc(id)
        const current = row(await ref.get())
        if (current?.status !== 'sending' || current.leaseOwner !== workerId)
          return false
        await ref.update({
          status: 'pending',
          nextAttemptAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: {
            code: 'delivery_failed',
            message: safeError(message),
          },
          updatedAt: now,
        })
        return true
      })
    },

    async pruneRateLimits(now, limit = 100) {
      const expired = rows(await db.collection(RATE_LIMITS_COLLECTION)
        .where({ expiresAt: command.lte(now) })
        .limit(limit)
        .get())
      for (const item of expired)
        await db.collection(RATE_LIMITS_COLLECTION).doc(item._id).remove()
      return expired.length
    },
  }
}

function safeError(value) {
  return typeof value === 'string'
    ? value.replace(/[\r\n\t]+/g, ' ').slice(0, 200)
    : 'delivery failed'
}

module.exports = {
  ALERTS_COLLECTION,
  LEASE_MS,
  RATE_LIMITS_COLLECTION,
  createRewardClaimOpsStore,
  isLeaseable,
}
