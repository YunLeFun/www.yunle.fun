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
  catch {
    const failure = {
      retryable: true,
      status: 0,
      attemptCount: Math.max(0, Number(job.attemptCount) || 0) + 1,
    }
    await store.markFailed(job._id, now, failure)
    return { sent: false, ...failure }
  }

  if (!recipient) {
    await store.markSkipped(job._id, now, 'no_verified_email')
    return { sent: false, skipped: true }
  }

  const rendered = renderLifecycleEmail(job)
  try {
    const result = await send({ to: recipient, ...rendered })
    await store.markSent(job._id, now, result?.id || null)
    if (job.type === 'deletion_completed' && typeof store.forgetRecipient === 'function')
      await store.forgetRecipient(job.userId)
    return { sent: true }
  }
  catch (error) {
    const failure = {
      retryable: error?.retryable === true,
      status: Number(error?.status) || 0,
      attemptCount: Math.max(0, Number(job.attemptCount) || 0) + 1,
    }
    await store.markFailed(job._id, now, failure)
    return { sent: false, ...failure }
  }
}

module.exports = { processNotificationJob }
