/** 事务邮件队列存储与定时扫描。 */

'use strict'

const ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION = 'account_lifecycle_notifications'
const ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION = 'account_lifecycle_contacts'
const SWEEP_LIMIT = 20
const PAGE = 100
const RETRY_BASE_MS = 5 * 60 * 1000
const RETRY_MAX_MS = 60 * 60 * 1000

function createNotificationStore(db) {
  return {
    async listDue(now) {
      const due = []
      let cursor = ''
      for (;;) {
        let query = db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION).orderBy('_id', 'asc')
        if (cursor)
          query = query.where({ _id: db.command.gt(cursor) })
        const { data } = await query.limit(PAGE).get()
        const rows = Array.isArray(data) ? data : []
        for (const row of rows) {
          if (row.status === 'pending'
            && Number.isFinite(row.scheduledFor)
            && row.scheduledFor <= now
            && (!Number.isFinite(row.nextAttemptAt) || row.nextAttemptAt <= now)) {
            due.push(row)
            if (due.length >= SWEEP_LIMIT)
              return due
          }
        }
        if (rows.length < PAGE)
          return due
        cursor = rows[rows.length - 1]._id
      }
    },
    async getRememberedRecipient(userId) {
      const result = await db.collection(ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION).doc(userId).get()
      const row = Array.isArray(result?.data) ? result.data[0] : result?.data
      return typeof row?.email === 'string' ? row.email : null
    },
    async rememberRecipient(userId, email, now) {
      await db.collection(ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION).doc(userId).set({
        userId,
        email,
        source: 'cloudbase_verified_auth',
        updatedAt: now,
      })
    },
    async forgetRecipient(userId) {
      await db.collection(ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION).doc(userId).remove()
    },
    async markSent(jobId, now, providerMessageId) {
      await db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION).doc(jobId).update({
        status: 'sent',
        sentAt: now,
        providerMessageId,
        nextAttemptAt: null,
        updatedAt: now,
      })
    },
    async markSkipped(jobId, now, reason) {
      await db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION).doc(jobId).update({
        status: 'skipped',
        skippedAt: now,
        skipReason: reason,
        nextAttemptAt: null,
        updatedAt: now,
      })
    },
    async markFailed(jobId, now, failure) {
      const attemptCount = Math.max(1, Number(failure?.attemptCount) || 1)
      const retryable = failure?.retryable === true && attemptCount < 3
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attemptCount - 1, 8))
      await db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION).doc(jobId).update({
        status: retryable ? 'pending' : 'failed',
        attemptCount,
        lastAttemptAt: now,
        lastHttpStatus: Number(failure?.status) || 0,
        nextAttemptAt: retryable ? now + delay : null,
        ...(retryable ? {} : { failedAt: now }),
        updatedAt: now,
      })
    },
  }
}

async function runNotificationSweep({ store, processJob, now = Date.now() }) {
  const due = await store.listDue(now)
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const job of due) {
    const result = await processJob(job)
    if (result?.sent)
      sent++
    else if (result?.skipped)
      skipped++
    else
      failed++
  }
  return { ok: failed === 0, scanned: due.length, sent, skipped, failed }
}

module.exports = {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  SWEEP_LIMIT,
  createNotificationStore,
  runNotificationSweep,
}
