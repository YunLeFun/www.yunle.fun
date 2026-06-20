import { describe, expect, it } from 'vitest'

import { requestAccountDeletion } from '../../cloudfunctions/account-api/account-deletion.js'
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
      { _id: 'f1', followerId: 'u1', followingId: 'u2', createdAt: 1 }, // u1 关注 u2
      { _id: 'f2', followerId: 'u3', followingId: 'u1', createdAt: 2 }, // u3 关注 u1
    ],
    [USER_NOTIFICATIONS_COLLECTION]: [
      { _id: 'n1', userId: 'u1', actorId: 'u3', type: 'follow' }, // u1 收到的（应删）
      { _id: 'n2', userId: 'u2', actorId: 'u1', type: 'follow' }, // u2 收到的（保留）
    ],
  }
}

async function readDoc(db, coll, id) {
  const { data } = await db.collection(coll).doc(id).get()
  return Array.isArray(data) ? data[0] : data
}

describe('account-api requestAccountDeletion (软注销)', () => {
  it('脱敏资料 + 释放 login + 计数清零 + 标记 deletedAt', async () => {
    const db = makeFakeDb(seed())
    const res = await requestAccountDeletion(db, { userId: 'u1', now: NOW })
    expect(res).toMatchObject({ deleted: true, deletedAt: NOW, removedFollowing: 1, removedFollowers: 1 })

    const u1 = await readDoc(db, USER_PROFILES_COLLECTION, 'u1')
    expect(u1.login).toBeNull()
    expect(u1.nickname).toBe('已注销用户')
    expect(u1.avatar).toBeNull()
    expect(u1.description).toBe('')
    expect(u1.followersCount).toBe(0)
    expect(u1.followingCount).toBe(0)
    expect(u1.hideFollowers).toBe(false)
    expect(u1.deletedAt).toBe(NOW)
  })

  it('双向解除关注并修正对端计数', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })

    const { data: follows } = await db.collection(USER_FOLLOWS_COLLECTION).where({}).get()
    expect(follows).toHaveLength(0)

    // u2 被 u1 关注 → followersCount 1→0
    const u2 = await readDoc(db, USER_PROFILES_COLLECTION, 'u2')
    expect(u2.followersCount).toBe(0)
    // u3 关注了 u1 → followingCount 1→0
    const u3 = await readDoc(db, USER_PROFILES_COLLECTION, 'u3')
    expect(u3.followingCount).toBe(0)
  })

  it('删除收到的通知，保留他人通知', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })

    const { data: mine } = await db.collection(USER_NOTIFICATIONS_COLLECTION).where({ userId: 'u1' }).get()
    expect(mine).toHaveLength(0)
    const { data: others } = await db.collection(USER_NOTIFICATIONS_COLLECTION).where({ userId: 'u2' }).get()
    expect(others).toHaveLength(1)
  })

  it('幂等：重复调用安全', async () => {
    const db = makeFakeDb(seed())
    await requestAccountDeletion(db, { userId: 'u1', now: NOW })
    const res2 = await requestAccountDeletion(db, { userId: 'u1', now: NOW + 1 })
    expect(res2.deleted).toBe(true)
    expect(res2.removedFollowing).toBe(0)
    expect(res2.removedFollowers).toBe(0)
  })

  it('userId 必填', async () => {
    const db = makeFakeDb(seed())
    await expect(requestAccountDeletion(db, { userId: '' })).rejects.toThrow(/userId/)
  })
})
