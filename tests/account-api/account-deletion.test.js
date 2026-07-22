import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_DELETION_COOLDOWN_MS,
  cancelAccountDeletion,
  finalizeAccountDeletion,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from '../../cloudfunctions/account-api/account-deletion.js'
import { USER_FOLLOWS_COLLECTION } from '../../cloudfunctions/account-api/follows.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications'
const NOW = 1_700_000_000_000

function seed() {
  return {
    [USER_PROFILES_COLLECTION]: [
      { _id: 'u1', login: 'alice', nickname: 'Alice', avatar: 'a.png', description: '嗨', followersCount: 1, followingCount: 1, hideFollowers: true, version: 1 },
      { _id: 'u2', login: 'bob', nickname: 'Bob', followersCount: 1, followingCount: 0, version: 1 },
      { _id: 'u3', login: 'carol', nickname: 'Carol', followersCount: 0, followingCount: 1, version: 1 },
    ],
    [USER_FOLLOWS_COLLECTION]: [
      { _id: 'f1', followerId: 'u1', followingId: 'u2', createdAt: 1 },
      { _id: 'f2', followerId: 'u3', followingId: 'u1', createdAt: 2 },
    ],
    [USER_NOTIFICATIONS_COLLECTION]: [
      { _id: 'n1', userId: 'u1', actorId: 'u3', type: 'follow' },
      { _id: 'n2', userId: 'u2', actorId: 'u1', type: 'follow' },
    ],
    github_installations: [{ _id: 'u1', installationId: '123' }],
    desktop_device_codes: [{ _id: 'dc1', uid: 'u1', status: 'approved' }],
    desktop_devices: [{ _id: 'd1', uid: 'u1', refreshTokenHash: 'hash' }],
    sso_login_codes: [{ _id: 's1', uid: 'u1', status: 'active' }],
    ai_usage_daily: [{ _id: 'q1', uid: 'u1', used: 1 }],
    user_signin_stats: [{ _id: 'sign1', userId: 'u1', currentStreak: 7 }],
  }
}

async function readDoc(db, coll, id) {
  const { data } = await db.collection(coll).doc(id).get()
  return Array.isArray(data) ? data[0] : data
}

describe('account-api 账号注销冷静期', () => {
  it('申请后进入 30 天冷静期，不立即清除资料或关系', async () => {
    const db = makeFakeDb(seed())

    const result = await requestAccountDeletion(db, { userId: 'u1', now: NOW })

    expect(ACCOUNT_DELETION_COOLDOWN_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(result).toMatchObject({
      status: 'pending',
      requestedAt: NOW,
      scheduledAt: NOW + ACCOUNT_DELETION_COOLDOWN_MS,
      remainingMs: ACCOUNT_DELETION_COOLDOWN_MS,
    })
    expect(await readDoc(db, USER_PROFILES_COLLECTION, 'u1')).toMatchObject({
      login: 'alice',
      nickname: 'Alice',
      deletionStatus: 'pending',
      deletionRequestedAt: NOW,
      deletionScheduledAt: NOW + ACCOUNT_DELETION_COOLDOWN_MS,
    })
    expect(db._store[USER_FOLLOWS_COLLECTION]).toHaveLength(2)
    expect(db._store[USER_NOTIFICATIONS_COLLECTION]).toHaveLength(2)
  })

  it('重复申请保持首次到期时间，不会延长冷静期', async () => {
    const db = makeFakeDb(seed())
    const first = await requestAccountDeletion(db, { userId: 'u1', now: NOW })
    const second = await requestAccountDeletion(db, { userId: 'u1', now: NOW + 60_000 })

    expect(second.scheduledAt).toBe(first.scheduledAt)
    expect(second.remainingMs).toBe(ACCOUNT_DELETION_COOLDOWN_MS - 60_000)
  })

  it('可查询剩余时间，并在到期前撤回', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })

    expect(await getAccountDeletionStatus(db, { userId: 'u1', now: NOW + 1_000 })).toMatchObject({
      status: 'pending',
      remainingMs: ACCOUNT_DELETION_COOLDOWN_MS - 1_000,
    })
    expect(await cancelAccountDeletion(db, { userId: 'u1', now: NOW + 1_000 })).toMatchObject({ status: 'none' })
    expect(await readDoc(db, USER_PROFILES_COLLECTION, 'u1')).toMatchObject({
      deletionStatus: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    })
  })

  it('到期前拒绝最终清理', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })

    const result = await finalizeAccountDeletion(db, {
      userId: 'u1',
      now: NOW + ACCOUNT_DELETION_COOLDOWN_MS - 1,
    })

    expect(result).toMatchObject({ finalized: false, reason: 'not_due' })
    expect((await readDoc(db, USER_PROFILES_COLLECTION, 'u1')).login).toBe('alice')
  })

  it('到期后清除公开资料、关系和通知，并等待认证身份删除', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })
    const dueAt = NOW + ACCOUNT_DELETION_COOLDOWN_MS

    const result = await finalizeAccountDeletion(db, { userId: 'u1', now: dueAt })

    expect(result).toMatchObject({
      finalized: true,
      deletedAt: dueAt,
      removedFollowing: 1,
      removedFollowers: 1,
      removedIdentityArtifacts: 6,
    })
    expect(await readDoc(db, USER_PROFILES_COLLECTION, 'u1')).toMatchObject({
      login: null,
      nickname: '已注销用户',
      avatar: null,
      description: '',
      followersCount: 0,
      followingCount: 0,
      deletionStatus: 'finalizing',
      deletedAt: dueAt,
      deletionScheduledAt: dueAt,
    })
    expect(db._store[USER_FOLLOWS_COLLECTION]).toHaveLength(0)
    expect(db._store[USER_NOTIFICATIONS_COLLECTION].filter(item => item.userId === 'u1')).toHaveLength(0)
    for (const collection of ['github_installations', 'desktop_device_codes', 'desktop_devices', 'sso_login_codes', 'ai_usage_daily', 'user_signin_stats'])
      expect(db._store[collection], `${collection} 应被清理`).toHaveLength(0)
  })

  it('撤回后不会被到期清理', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })
    await cancelAccountDeletion(db, { userId: 'u1', now: NOW + 1 })

    await expect(finalizeAccountDeletion(db, {
      userId: 'u1',
      now: NOW + ACCOUNT_DELETION_COOLDOWN_MS,
    })).resolves.toMatchObject({ finalized: false, reason: 'not_pending' })
  })

  it('userId 必填', async () => {
    const db = makeFakeDb(seed())
    await expect(requestAccountDeletion(db, { userId: '' })).rejects.toThrow(/userId/)
  })
})
