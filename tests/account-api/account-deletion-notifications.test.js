import { describe, expect, it, vi } from 'vitest'

import {
  ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION,
  ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION,
  cancelDeletionNotifications,
  enqueueDeletionNotifications,
} from '../../cloudfunctions/account-api/account-deletion-notifications.js'
import {
  ACCOUNT_DELETION_COOLDOWN_MS,
  cancelAccountDeletion,
  requestAccountDeletion,
} from '../../cloudfunctions/account-api/account-deletion.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function db() {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [{ _id: 'u1', login: 'alice' }],
    [ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]: [],
    [ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]: [],
  })
}

describe('account deletion notification queue', () => {
  it('幂等创建申请确认、7 天和 1 天提醒', async () => {
    const target = db()
    const scheduledAt = NOW + ACCOUNT_DELETION_COOLDOWN_MS

    await enqueueDeletionNotifications(target, { userId: 'u1', requestedAt: NOW, scheduledAt })
    await enqueueDeletionNotifications(target, { userId: 'u1', requestedAt: NOW, scheduledAt })

    expect(target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]).toHaveLength(3)
    expect(target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION]).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'deletion_requested', scheduledFor: NOW, status: 'pending' }),
      expect.objectContaining({ type: 'deletion_reminder_7d', scheduledFor: scheduledAt - 7 * DAY, status: 'pending' }),
      expect.objectContaining({ type: 'deletion_reminder_1d', scheduledFor: scheduledAt - DAY, status: 'pending' }),
    ]))
  })

  it('撤回注销会取消尚未发送的提醒', async () => {
    const target = db()
    await requestAccountDeletion(target, { userId: 'u1', now: NOW })

    await cancelAccountDeletion(target, { userId: 'u1', now: NOW + 1 })

    expect(target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION])
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'deletion_reminder_7d', status: 'cancelled' }),
        expect.objectContaining({ type: 'deletion_reminder_1d', status: 'cancelled' }),
      ]))
  })

  it('通知队列故障不阻断注销状态提交', async () => {
    const target = db()
    const originalCollection = target.collection.bind(target)
    target.collection = vi.fn((name) => {
      const collection = originalCollection(name)
      if (name !== ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION)
        return collection
      return {
        ...collection,
        add: async () => { throw new Error('queue unavailable') },
      }
    })

    await expect(requestAccountDeletion(target, { userId: 'u1', now: NOW }))
      .resolves
      .toMatchObject({ status: 'pending' })
    expect(target._store[USER_PROFILES_COLLECTION][0]).toMatchObject({
      deletionStatus: 'pending',
      deletionScheduledAt: NOW + ACCOUNT_DELETION_COOLDOWN_MS,
    })
  })

  it('取消函数只修改本次注销周期的 pending 任务', async () => {
    const target = db()
    await enqueueDeletionNotifications(target, {
      userId: 'u1',
      requestedAt: NOW,
      scheduledAt: NOW + ACCOUNT_DELETION_COOLDOWN_MS,
    })
    target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0].status = 'sent'

    await cancelDeletionNotifications(target, { userId: 'u1', requestedAt: NOW, now: NOW + 1 })

    expect(target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION][0].status).toBe('sent')
    expect(target._store[ACCOUNT_LIFECYCLE_NOTIFICATIONS_COLLECTION].slice(1))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: 'cancelled' })]))
  })

  it('撤回注销会删除为生命周期邮件临时缓存的联系方式', async () => {
    const target = db()
    target._store[ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION].push({
      _id: 'u1',
      userId: 'u1',
      email: 'verified@example.com',
    })

    await cancelDeletionNotifications(target, { userId: 'u1', requestedAt: NOW, now: NOW + 1 })

    expect(target._store[ACCOUNT_LIFECYCLE_CONTACTS_COLLECTION]).toEqual([])
  })
})
