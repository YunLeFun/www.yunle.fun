/** 单个事务邮件任务的幂等处理。 */

'use strict'

const { renderLifecycleEmail } = require('./templates')

async function processNotificationJob(job, {
  store,
  send,
  resolveRecipient,
  opsEmail,
  now = Date.now(),
}) {
  async function recordFailure(error, fallbackCode, retryableDefault = false) {
    const failure = {
      retryable: typeof error?.retryable === 'boolean'
        ? error.retryable
        : retryableDefault,
      code: typeof error?.code === 'string' ? error.code : fallbackCode,
      attemptCount: Math.max(0, Number(job.attemptCount) || 0) + 1,
    }
    await store.markFailed(job._id, now, failure)
    return { sent: false, ...failure }
  }

  let recipient = null
  try {
    if (job.type === 'deletion_cleanup_ops') {
      recipient = opsEmail || null
    }
    else {
      recipient = await store.getRememberedRecipient(job.userId)
      if (!recipient && typeof resolveRecipient === 'function') {
        recipient = await resolveRecipient(job.userId)
        if (recipient)
          await store.rememberRecipient(job.userId, recipient, now)
      }
    }
  }
  catch (error) {
    return recordFailure(error, 'RecipientLookupFailed', true)
  }

  if (!recipient) {
    await store.markSkipped(job._id, now, 'no_verified_email')
    return { sent: false, skipped: true }
  }

  let quota
  try {
    quota = await store.reserveQuota(job, now)
  }
  catch (error) {
    return recordFailure(error, 'QuotaReservationFailed', true)
  }
  if (!quota?.reserved)
    return { sent: false, deferred: true, quotaBucket: quota?.bucket || 'user' }

  try {
    const rendered = renderLifecycleEmail(job)
    const result = await send({
      id: job._id,
      type: job.type,
      to: recipient,
      ...rendered,
    })
    await store.markSubmitted(job._id, now, result?.id || null)
    if (job.type === 'deletion_completed' && typeof store.finishLifecycleContact === 'function')
      await store.finishLifecycleContact(job.userId, job.requestedAt, now)
    return { sent: true, submitted: true, quotaBucket: quota.bucket }
  }
  catch (error) {
    return recordFailure(error, 'UnknownError')
  }
}

module.exports = { processNotificationJob }
