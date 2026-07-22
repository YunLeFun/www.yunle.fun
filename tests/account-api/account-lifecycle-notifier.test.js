import { describe, expect, it, vi } from 'vitest'

import { createRecipientResolver } from '../../cloudfunctions/account-lifecycle-notifier/recipient.js'
import {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  createNotificationStore,
  runNotificationSweep,
} from '../../cloudfunctions/account-lifecycle-notifier/sweep.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

describe('account lifecycle notifier sweep', () => {
  it('只处理到期且已到重试时间的 pending 任务', async () => {
    const db = makeFakeDb({
      [ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]: [
        { _id: 'due', status: 'pending', scheduledFor: NOW - 1, nextAttemptAt: NOW - 1 },
        { _id: 'future', status: 'pending', scheduledFor: NOW + 1, nextAttemptAt: NOW + 1 },
        { _id: 'backoff', status: 'pending', scheduledFor: NOW - 1, nextAttemptAt: NOW + 1 },
        { _id: 'sent', status: 'sent', scheduledFor: NOW - 1, nextAttemptAt: NOW - 1 },
      ],
      [ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]: [],
    })
    const store = createNotificationStore(db)
    const processJob = vi.fn(async () => ({ sent: true }))

    await expect(runNotificationSweep({ store, processJob, now: NOW })).resolves.toMatchObject({
      scanned: 1,
      sent: 1,
      failed: 0,
    })
    expect(processJob).toHaveBeenCalledWith(expect.objectContaining({ _id: 'due' }))
  })

  it('可重试错误指数退避，第三次后终止自动重试', async () => {
    const db = makeFakeDb({
      [ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]: [{
        _id: 'job',
        status: 'pending',
        attemptCount: 0,
        scheduledFor: NOW,
        nextAttemptAt: NOW,
      }],
      [ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]: [],
    })
    const store = createNotificationStore(db)

    await store.markFailed('job', NOW, { retryable: true, status: 429, attemptCount: 1 })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0]).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      lastHttpStatus: 429,
    })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0].nextAttemptAt).toBeGreaterThan(NOW)

    await store.markFailed('job', NOW + 1, { retryable: true, status: 500, attemptCount: 3 })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0]).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      failedAt: NOW + 1,
    })
  })

  it('auth 收件地址解析兼容 Manager SDK 结构并拒绝未验证邮箱', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn()
          .mockResolvedValueOnce({ Data: { UserList: [{ Email: 'verified@example.com', EmailVerified: true }] } })
          .mockResolvedValueOnce({ Data: { UserList: [{ Email: 'unverified@example.com', EmailVerified: false }] } }),
      },
    }
    const resolve = createRecipientResolver(manager)

    await expect(resolve('u1')).resolves.toBe('verified@example.com')
    await expect(resolve('u2')).resolves.toBeNull()
  })
})
