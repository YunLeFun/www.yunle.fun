import { describe, expect, it, vi } from 'vitest'

import { createRecipientResolver } from '../../cloudfunctions/account-lifecycle-notifier/recipient.js'
import {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  createNotificationStore,
  RETENTION_MS,
  runDeliveryStatusSweep,
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

    await expect(runNotificationSweep({ store, processJob, mode: 'live', now: NOW })).resolves.toMatchObject({
      scanned: 1,
      sent: 1,
      failed: 0,
    })
    expect(processJob).toHaveBeenCalledWith(expect.objectContaining({ _id: 'due' }))
  })

  it('可重试错误按计划退避，第五次后终止自动重试并释放额度', async () => {
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
    const store = createNotificationStore(db, { random: () => 0.5 })

    await store.markFailed('job', NOW, {
      retryable: true,
      code: 'RequestLimitExceeded',
      attemptCount: 1,
    })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0]).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      lastErrorCode: 'RequestLimitExceeded',
      nextAttemptAt: NOW + 5 * 60 * 1000,
    })

    await store.markFailed('job', NOW + 1, {
      retryable: true,
      code: 'InternalError',
      attemptCount: 5,
    })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0]).toMatchObject({
      status: 'failed',
      attemptCount: 5,
      failedAt: NOW + 1,
      retentionExpiresAt: NOW + 1 + RETENTION_MS,
    })
  })

  it('dry-run 只报告任务，不修改记录或调用处理器', async () => {
    const store = {
      listDue: vi.fn(async () => [{
        _id: 'due',
        type: 'deletion_requested',
        status: 'pending',
        scheduledFor: NOW,
      }]),
    }
    const processJob = vi.fn()

    await expect(runNotificationSweep({
      store,
      processJob,
      mode: 'dry_run',
      now: NOW,
    })).resolves.toEqual({
      ok: true,
      mode: 'dry_run',
      scanned: 1,
      wouldSubmit: 1,
      submitted: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    })
    expect(processJob).not.toHaveBeenCalled()
  })

  it('到期任务按事务优先级处理，额度不足时由任务处理器延后', async () => {
    const store = {
      listDue: vi.fn(async () => [
        { _id: 'reminder-7d', type: 'deletion_reminder_7d', scheduledFor: NOW - 5 },
        { _id: 'completed', type: 'deletion_completed', scheduledFor: NOW - 1 },
        { _id: 'requested', type: 'deletion_requested', scheduledFor: NOW - 2 },
        { _id: 'ops', type: 'deletion_cleanup_ops', scheduledFor: NOW - 3 },
      ]),
    }
    const processJob = vi.fn(async job => (
      job._id === 'reminder-7d'
        ? { sent: false, deferred: true }
        : { sent: true, submitted: true }
    ))

    await expect(runNotificationSweep({
      store,
      processJob,
      mode: 'live',
      now: NOW,
    })).resolves.toMatchObject({
      submitted: 3,
      deferred: 1,
      failed: 0,
    })
    expect(processJob.mock.calls.map(([job]) => job._id)).toEqual([
      'requested',
      'completed',
      'ops',
      'reminder-7d',
    ])
  })

  it('用户与运维额度独立原子预留，发送失败会释放名额', async () => {
    const jobs = [
      { _id: 'user-1', type: 'deletion_requested', status: 'pending' },
      { _id: 'user-2', type: 'deletion_completed', status: 'pending' },
      { _id: 'user-3', type: 'deletion_reminder_1d', status: 'pending' },
      { _id: 'ops-1', type: 'deletion_cleanup_ops', status: 'pending' },
      { _id: 'ops-2', type: 'deletion_cleanup_ops', status: 'pending' },
    ]
    const db = makeFakeDb({
      [ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]: jobs,
      [ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]: [],
    })
    const store = createNotificationStore(db, {
      userDailyLimit: 2,
      opsDailyLimit: 1,
      random: () => 0.5,
    })

    await expect(store.reserveQuota(jobs[0], NOW)).resolves.toMatchObject({ reserved: true, bucket: 'user' })
    await expect(store.reserveQuota(jobs[1], NOW)).resolves.toMatchObject({ reserved: true, bucket: 'user' })
    await expect(store.reserveQuota(jobs[2], NOW)).resolves.toMatchObject({ reserved: false, bucket: 'user' })
    await expect(store.reserveQuota(jobs[3], NOW)).resolves.toMatchObject({ reserved: true, bucket: 'ops' })
    await expect(store.reserveQuota(jobs[4], NOW)).resolves.toMatchObject({ reserved: false, bucket: 'ops' })

    await store.markFailed('user-1', NOW + 1, {
      retryable: false,
      code: 'InvalidParameterValue',
      attemptCount: 1,
    })
    await expect(store.reserveQuota(jobs[2], NOW + 2)).resolves.toMatchObject({ reserved: true, bucket: 'user' })
  })

  it('轮询投递状态，硬退信生成一次脱敏运维告警', async () => {
    const submittedJob = {
      _id: 'job-1',
      type: 'deletion_requested',
      status: 'submitted',
      providerMessageId: 'message-1',
      submittedAt: NOW - 60_000,
    }
    const store = {
      listSubmittedForStatus: vi.fn(async () => [submittedJob]),
      markDeliveryStatus: vi.fn(async () => undefined),
      enqueueDeliveryAlert: vi.fn(async () => true),
    }
    const getStatus = vi.fn(async () => ({
      state: 'bounced',
      sendStatus: 0,
      deliverStatus: 3,
      complained: false,
      deliverTime: null,
    }))

    await expect(runDeliveryStatusSweep({
      store,
      getStatus,
      now: NOW,
    })).resolves.toEqual({
      checked: 1,
      delivered: 0,
      pending: 0,
      failed: 1,
      alertsQueued: 1,
      errors: 0,
    })
    expect(store.markDeliveryStatus).toHaveBeenCalledWith(
      'job-1',
      NOW,
      expect.objectContaining({
        state: 'bounced',
        sendStatus: 0,
        deliverStatus: 3,
      }),
    )
    expect(store.enqueueDeliveryAlert).toHaveBeenCalledWith(
      submittedJob,
      expect.objectContaining({ state: 'bounced' }),
      NOW,
    )
  })

  it('删除超过 30 天的投递元数据和过期联系人', async () => {
    const db = makeFakeDb({
      [ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]: [
        { _id: 'old', status: 'delivered', retentionExpiresAt: NOW - 1 },
        { _id: 'new', status: 'delivered', retentionExpiresAt: NOW + 1 },
      ],
      [ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]: [
        { _id: 'old-contact', expiresAt: NOW - 1 },
        { _id: 'new-contact', expiresAt: NOW + 1 },
      ],
    })
    const store = createNotificationStore(db)

    await expect(store.pruneExpired(NOW)).resolves.toEqual({
      notifications: 1,
      contacts: 1,
    })
    expect(db._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION].map(row => row._id)).toEqual(['new'])
    expect(db._store[ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION].map(row => row._id)).toEqual(['new-contact'])
  })

  it('auth 收件地址解析兼容 Manager SDK 结构并拒绝非法邮箱', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn()
          .mockResolvedValueOnce({ Data: { UserList: [{ Email: 'recipient@example.com' }] } })
          .mockResolvedValueOnce({ Data: { UserList: [{ Email: 'invalid address' }] } }),
      },
    }
    const resolve = createRecipientResolver(manager)

    await expect(resolve('u1')).resolves.toBe('recipient@example.com')
    await expect(resolve('u2')).resolves.toBeNull()
  })
})
