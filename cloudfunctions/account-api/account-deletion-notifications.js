/** 持久化账号生命周期通知任务；发送由独立定时函数处理。 */

'use strict'

const crypto = require('node:crypto')

const ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION = 'account_lifecycle_notifications'
const ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION = 'account_lifecycle_contacts'
const DAY_MS = 24 * 60 * 60 * 1000

function notificationId(userId, requestedAt, type) {
  return crypto
    .createHash('sha256')
    .update(`${userId}\0${requestedAt}\0${type}`)
    .digest('hex')
}

async function addOnce(db, job) {
  const collection = db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
  const existing = await collection.doc(job._id).get()
  if (existing?.data && (!Array.isArray(existing.data) || existing.data.length > 0))
    return false
  try {
    await collection.add(job)
    return true
  }
  catch (error) {
    if (/duplicate|already exists|已存在/i.test(error?.message || ''))
      return false
    throw error
  }
}

async function enqueueDeletionNotifications(db, { userId, requestedAt, scheduledAt }) {
  const definitions = [
    ['deletion_requested', requestedAt],
    ['deletion_reminder_7d', scheduledAt - 7 * DAY_MS],
    ['deletion_reminder_1d', scheduledAt - DAY_MS],
  ]
  for (const [type, scheduledFor] of definitions) {
    await addOnce(db, {
      _id: notificationId(userId, requestedAt, type),
      userId,
      requestedAt,
      deletionScheduledAt: scheduledAt,
      type,
      status: 'pending',
      scheduledFor,
      attemptCount: 0,
      nextAttemptAt: scheduledFor,
      createdAt: requestedAt,
      updatedAt: requestedAt,
    })
  }
}

async function enqueueLifecycleNotification(db, {
  userId,
  requestedAt,
  type,
  scheduledFor,
  now,
  metadata,
}) {
  return addOnce(db, {
    _id: notificationId(userId, requestedAt, type),
    userId,
    requestedAt,
    type,
    status: 'pending',
    scheduledFor,
    nextAttemptAt: scheduledFor,
    attemptCount: 0,
    metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    createdAt: now,
    updatedAt: now,
  })
}

async function cancelDeletionNotifications(db, { userId, requestedAt, now }) {
  const [notifications] = await Promise.all([
    db.collection(ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
      .where({ userId, requestedAt, status: 'pending' })
      .update({ status: 'cancelled', cancelledAt: now, updatedAt: now }),
    // 联系方式仅为本轮生命周期邮件临时缓存；用户撤回后不再具有处理目的。
    db.collection(ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION).doc(userId).remove(),
  ])
  return notifications
}

module.exports = {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  cancelDeletionNotifications,
  enqueueDeletionNotifications,
  enqueueLifecycleNotification,
  notificationId,
}
