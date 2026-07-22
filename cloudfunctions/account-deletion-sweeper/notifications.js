/** 注销清理任务只写持久化通知队列，不直接接触邮箱或发送凭据。 */

'use strict'

const crypto = require('node:crypto')

const COLLECTION = 'account_lifecycle_notifications'

function id(userId, requestedAt, type) {
  return crypto.createHash('sha256').update(`${userId}\0${requestedAt}\0${type}`).digest('hex')
}

function caseRef(userId, requestedAt) {
  return crypto.createHash('sha256').update(`${userId}\0${requestedAt}`).digest('hex').slice(0, 16)
}

function createLifecycleNotifier(db) {
  async function enqueue(userId, type, now, metadata) {
    const result = await db.collection('user_profiles').doc(userId).get()
    const profile = Array.isArray(result?.data) ? result.data[0] : result?.data
    const requestedAt = Number.isFinite(profile?.deletionRequestedAt)
      ? profile.deletionRequestedAt
      : Number.isFinite(profile?.deletionScheduledAt) ? profile.deletionScheduledAt : now
    const jobId = id(userId, requestedAt, type)
    const existing = await db.collection(COLLECTION).doc(jobId).get()
    if (existing?.data && (!Array.isArray(existing.data) || existing.data.length > 0))
      return false
    await db.collection(COLLECTION).add({
      _id: jobId,
      userId,
      requestedAt,
      deletionScheduledAt: profile?.deletionScheduledAt || null,
      type,
      status: 'pending',
      scheduledFor: now,
      nextAttemptAt: now,
      attemptCount: 0,
      metadata,
      createdAt: now,
      updatedAt: now,
    })
    return true
  }

  return {
    notifyCompleted: (userId, now) => enqueue(userId, 'deletion_completed', now),
    notifyDelayed: (userId, failure) => enqueue(userId, 'deletion_delayed', Date.now(), {
      failureCount: failure.failureCount,
    }),
    alertOps: async (userId, failure) => {
      const now = Date.now()
      const result = await db.collection('user_profiles').doc(userId).get()
      const profile = Array.isArray(result?.data) ? result.data[0] : result?.data
      const requestedAt = profile?.deletionRequestedAt || profile?.deletionScheduledAt || now
      return enqueue(userId, 'deletion_cleanup_ops', now, {
        caseRef: caseRef(userId, requestedAt),
        failureCount: failure.failureCount,
      })
    },
  }
}

module.exports = { createLifecycleNotifier }
