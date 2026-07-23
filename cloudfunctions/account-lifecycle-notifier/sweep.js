/** Transactional email queue storage, quota enforcement, and delivery polling. */

'use strict'

const crypto = require('node:crypto')

const ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION = 'account_lifecycle_notifications'
const ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION = 'account_lifecycle_contacts'
const SWEEP_LIMIT = 20
const STATUS_SWEEP_LIMIT = 20
const PAGE = 100
const DUE_SCAN_LIMIT = 500
const USER_DAILY_LIMIT = 45
const OPS_DAILY_LIMIT = 5
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CONTACT_RETENTION_MS = 38 * 24 * 60 * 60 * 1000
const SEND_LEASE_MS = 2 * 60 * 1000
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
]

const PRIORITY = {
  deletion_requested: 0,
  deletion_completed: 1,
  deletion_cleanup_ops: 2,
  deletion_delayed: 3,
  deletion_reminder_1d: 4,
  deletion_reminder_7d: 5,
}

const TERMINAL_DELIVERY_STATES = new Set([
  'delivered',
  'bounced',
  'dropped',
  'complained',
  'provider_failed',
])
const FAILED_DELIVERY_STATES = new Set([
  'bounced',
  'dropped',
  'complained',
  'provider_failed',
])

function chinaDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  return Object.fromEntries(parts.map(part => [part.type, part.value]))
}

function quotaWindow(now) {
  const parts = chinaDateParts(now)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const start = Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000
  const end = Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    start,
    end,
  }
}

function isOpsJob(job) {
  return job?.type === 'deletion_cleanup_ops'
}

function retryDelayMs(attemptCount, random = Math.random) {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)]
  const jitter = 0.8 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4
  return Math.round(base * jitter)
}

function sortDueJobs(rows) {
  return rows.slice().sort((left, right) => {
    const priority = (PRIORITY[left.type] ?? 99) - (PRIORITY[right.type] ?? 99)
    if (priority !== 0)
      return priority
    const scheduled = (Number(left.scheduledFor) || 0) - (Number(right.scheduledFor) || 0)
    return scheduled || String(left._id).localeCompare(String(right._id))
  })
}

function readDoc(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data || null
}

function updatedCount(result) {
  return Number(result?.updated ?? result?.modifiedCount ?? result?.deleted ?? 0) || 0
}

function createNotificationStore(db, {
  random = Math.random,
  userDailyLimit = USER_DAILY_LIMIT,
  opsDailyLimit = OPS_DAILY_LIMIT,
} = {}) {
  const notifications = () => db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
  const contacts = () => db.collection(ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION)

  return {
    async listDue(now) {
      const due = []
      let cursor = ''
      for (;;) {
        let query = notifications().orderBy('_id', 'asc')
        if (cursor)
          query = query.where({ _id: db.command.gt(cursor) })
        const { data } = await query.limit(PAGE).get()
        const rows = Array.isArray(data) ? data : []
        for (const row of rows) {
          const pending = row.status === 'pending'
          const leaseExpired = row.status === 'sending'
            && Number.isFinite(row.leaseExpiresAt)
            && row.leaseExpiresAt <= now
          if ((pending || leaseExpired)
            && Number.isFinite(row.scheduledFor)
            && row.scheduledFor <= now
            && (!Number.isFinite(row.nextAttemptAt) || row.nextAttemptAt <= now)) {
            due.push(row)
          }
        }
        if (rows.length < PAGE || due.length >= DUE_SCAN_LIMIT)
          return sortDueJobs(due).slice(0, SWEEP_LIMIT)
        cursor = rows[rows.length - 1]._id
      }
    },
    async getRememberedRecipient(userId) {
      const row = readDoc(await contacts().doc(userId).get())
      return typeof row?.email === 'string' ? row.email : null
    },
    async rememberRecipient(userId, email, now) {
      await contacts().doc(userId).set({
        userId,
        email,
        source: 'cloudbase_verified_auth',
        updatedAt: now,
        expiresAt: now + CONTACT_RETENTION_MS,
      })
    },
    async finishLifecycleContact(userId, requestedAt, now) {
      const where = Number.isFinite(requestedAt) ? { userId, requestedAt } : { userId }
      await Promise.all([
        notifications().where(where).update({
          userId: null,
          redactedAt: now,
          updatedAt: now,
        }),
        contacts().doc(userId).remove(),
      ])
    },
    async reserveQuota(job, now) {
      const bucket = isOpsJob(job) ? 'ops' : 'user'
      const limit = bucket === 'ops' ? opsDailyLimit : userDailyLimit
      const window = quotaWindow(now)
      const quotaId = `__quota__:${window.dayKey}`

      return db.runTransaction(async (transaction) => {
        const collection = transaction.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
        const jobRef = collection.doc(job._id)
        const currentJob = readDoc(await jobRef.get())
        if (!currentJob)
          return { reserved: false, bucket, reason: 'job_missing' }
        if (currentJob.status === 'sending' && currentJob.quotaReserved === true) {
          await jobRef.update({ leaseExpiresAt: now + SEND_LEASE_MS, updatedAt: now })
          return { reserved: true, bucket }
        }
        if (currentJob.status !== 'pending')
          return { reserved: false, bucket, reason: 'job_not_pending' }

        const quotaRef = collection.doc(quotaId)
        const quota = readDoc(await quotaRef.get()) || {}
        const field = bucket === 'ops' ? 'opsReserved' : 'userReserved'
        const used = Math.max(0, Number(quota[field]) || 0)
        if (used >= limit)
          return { reserved: false, bucket, reason: 'daily_limit' }

        await quotaRef.set({
          kind: 'daily_quota',
          dayKey: window.dayKey,
          userReserved: Math.max(0, Number(quota.userReserved) || 0) + (bucket === 'user' ? 1 : 0),
          opsReserved: Math.max(0, Number(quota.opsReserved) || 0) + (bucket === 'ops' ? 1 : 0),
          updatedAt: now,
          expiresAt: window.end + RETENTION_MS,
        })
        await jobRef.update({
          status: 'sending',
          quotaBucket: bucket,
          quotaDayKey: window.dayKey,
          quotaReserved: true,
          leaseExpiresAt: now + SEND_LEASE_MS,
          updatedAt: now,
        })
        return { reserved: true, bucket }
      })
    },
    async markSubmitted(jobId, now, providerMessageId) {
      await notifications().doc(jobId).update({
        status: 'submitted',
        submittedAt: now,
        providerMessageId,
        quotaCommitted: true,
        quotaReserved: false,
        leaseExpiresAt: null,
        nextStatusCheckAt: now + 15 * 60 * 1000,
        nextAttemptAt: null,
        retentionExpiresAt: now + RETENTION_MS,
        updatedAt: now,
      })
    },
    async markSkipped(jobId, now, reason) {
      await notifications().doc(jobId).update({
        status: 'skipped',
        skippedAt: now,
        skipReason: reason,
        nextAttemptAt: null,
        retentionExpiresAt: now + RETENTION_MS,
        updatedAt: now,
      })
    },
    async markFailed(jobId, now, failure) {
      const attemptCount = Math.max(1, Number(failure?.attemptCount) || 1)
      const retryable = failure?.retryable === true && attemptCount < RETRY_DELAYS_MS.length
      const nextAttemptAt = retryable ? now + retryDelayMs(attemptCount, random) : null
      const code = typeof failure?.code === 'string' && failure.code
        ? failure.code.slice(0, 128)
        : 'UnknownError'

      await db.runTransaction(async (transaction) => {
        const collection = transaction.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
        const jobRef = collection.doc(jobId)
        const job = readDoc(await jobRef.get())
        if (!job)
          return

        if (job.quotaReserved === true && job.quotaDayKey) {
          const quotaRef = collection.doc(`__quota__:${job.quotaDayKey}`)
          const quota = readDoc(await quotaRef.get())
          if (quota) {
            const field = job.quotaBucket === 'ops' ? 'opsReserved' : 'userReserved'
            const quotaData = { ...quota }
            delete quotaData._id
            await quotaRef.set({
              ...quotaData,
              [field]: Math.max(0, (Number(quota[field]) || 0) - 1),
              updatedAt: now,
            })
          }
        }

        await jobRef.update({
          status: retryable ? 'pending' : 'failed',
          attemptCount,
          lastAttemptAt: now,
          lastErrorCode: code,
          nextAttemptAt,
          quotaReserved: false,
          leaseExpiresAt: null,
          ...(retryable
            ? {}
            : {
                failedAt: now,
                retentionExpiresAt: now + RETENTION_MS,
              }),
          updatedAt: now,
        })
      })
    },
    async listSubmittedForStatus(now) {
      const due = []
      let cursor = ''
      for (;;) {
        let query = notifications().orderBy('_id', 'asc')
        if (cursor)
          query = query.where({ _id: db.command.gt(cursor) })
        const { data } = await query.limit(PAGE).get()
        const rows = Array.isArray(data) ? data : []
        for (const row of rows) {
          if (row.status === 'submitted'
            && typeof row.providerMessageId === 'string'
            && (!Number.isFinite(row.nextStatusCheckAt) || row.nextStatusCheckAt <= now)) {
            due.push(row)
            if (due.length >= STATUS_SWEEP_LIMIT)
              return due
          }
        }
        if (rows.length < PAGE)
          return due
        cursor = rows[rows.length - 1]._id
      }
    },
    async markDeliveryStatus(jobId, now, result) {
      const state = TERMINAL_DELIVERY_STATES.has(result?.state)
        ? result.state
        : 'submitted'
      const pendingDelay = result?.state === 'deferred'
        ? 60 * 60 * 1000
        : 15 * 60 * 1000
      await notifications().doc(jobId).update({
        status: state,
        providerState: result?.state || 'submitted',
        providerSendStatus: Number.isFinite(result?.sendStatus) ? result.sendStatus : null,
        providerDeliverStatus: Number.isFinite(result?.deliverStatus) ? result.deliverStatus : null,
        providerComplained: result?.complained === true,
        deliveryUpdatedAt: now,
        deliveredAt: state === 'delivered' ? (result.deliverTime || now) : null,
        nextStatusCheckAt: state === 'submitted' ? now + pendingDelay : null,
        updatedAt: now,
      })
    },
    async enqueueDeliveryAlert(job, result, now) {
      if (isOpsJob(job))
        return false
      const ref = crypto
        .createHash('sha256')
        .update(`${job._id}\0${result.state}`)
        .digest('hex')
      try {
        await notifications().add({
          _id: `ops_${ref}`,
          userId: null,
          requestedAt: job.requestedAt || null,
          type: 'deletion_cleanup_ops',
          status: 'pending',
          scheduledFor: now,
          nextAttemptAt: now,
          attemptCount: 0,
          metadata: {
            caseRef: String(job._id).slice(-12),
            errorCode: `${result.state}:${result.sendStatus ?? 'na'}:${result.deliverStatus ?? 'na'}`,
            failureCount: 1,
          },
          createdAt: now,
          updatedAt: now,
        })
        return true
      }
      catch (error) {
        if (/duplicate|already exists|已存在/i.test(error?.message || ''))
          return false
        throw error
      }
    },
    async pruneExpired(now) {
      const notificationIds = []
      const contactIds = []
      const notificationRows = await notifications().limit(DUE_SCAN_LIMIT).get()
      for (const row of notificationRows?.data || []) {
        const expiresAt = row.kind === 'daily_quota' ? row.expiresAt : row.retentionExpiresAt
        if (Number.isFinite(expiresAt) && expiresAt <= now)
          notificationIds.push(row._id)
      }
      const contactRows = await contacts().limit(DUE_SCAN_LIMIT).get()
      for (const row of contactRows?.data || []) {
        if (Number.isFinite(row.expiresAt) && row.expiresAt <= now)
          contactIds.push(row._id)
      }
      const notificationResults = await Promise.all(notificationIds.map(id => notifications().doc(id).remove()))
      const contactResults = await Promise.all(contactIds.map(id => contacts().doc(id).remove()))
      return {
        notifications: notificationResults.reduce((sum, result) => sum + updatedCount(result), 0),
        contacts: contactResults.reduce((sum, result) => sum + updatedCount(result), 0),
      }
    },
  }
}

async function runNotificationSweep({
  store,
  processJob,
  mode = 'dry_run',
  now = Date.now(),
}) {
  const due = await store.listDue(now)
  if (mode !== 'live') {
    return {
      ok: true,
      mode: 'dry_run',
      scanned: due.length,
      wouldSubmit: due.length,
      submitted: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    }
  }

  let submitted = 0
  let failed = 0
  let skipped = 0
  let deferred = 0
  for (const job of sortDueJobs(due)) {
    const result = await processJob(job)
    if (result?.submitted || result?.sent)
      submitted++
    else if (result?.skipped)
      skipped++
    else if (result?.deferred)
      deferred++
    else
      failed++
  }
  return {
    ok: failed === 0,
    mode: 'live',
    scanned: due.length,
    submitted,
    sent: submitted,
    skipped,
    failed,
    deferred,
  }
}

async function runDeliveryStatusSweep({ store, getStatus, now = Date.now() }) {
  const jobs = await store.listSubmittedForStatus(now)
  let delivered = 0
  let pending = 0
  let failed = 0
  let alertsQueued = 0
  let errors = 0
  for (const job of jobs) {
    try {
      const result = await getStatus({
        messageId: job.providerMessageId,
        submittedAt: job.submittedAt,
      })
      await store.markDeliveryStatus(job._id, now, result)
      if (result.state === 'delivered') {
        delivered++
      }
      else if (FAILED_DELIVERY_STATES.has(result.state)) {
        failed++
        if (await store.enqueueDeliveryAlert(job, result, now))
          alertsQueued++
      }
      else {
        pending++
      }
    }
    catch {
      errors++
    }
  }
  return {
    checked: jobs.length,
    delivered,
    pending,
    failed,
    alertsQueued,
    errors,
  }
}

module.exports = {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  CONTACT_RETENTION_MS,
  OPS_DAILY_LIMIT,
  RETENTION_MS,
  RETRY_DELAYS_MS,
  SWEEP_LIMIT,
  USER_DAILY_LIMIT,
  createNotificationStore,
  quotaWindow,
  retryDelayMs,
  runDeliveryStatusSweep,
  runNotificationSweep,
  sortDueJobs,
}
